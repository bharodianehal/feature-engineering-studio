"""Feature Engineering Studio — FastAPI Backend (v3 — Projects + Feature Inventory)"""

import os
import re
import math
import uuid
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sklearn.cluster import KMeans, DBSCAN
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score
import umap

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Feature Engineering Studio")
w = WorkspaceClient()


WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")
APP_CATALOG = os.environ.get("APP_CATALOG", "")
APP_SCHEMA = "fe_studio_app"


@app.on_event("startup")
def on_startup():
    if APP_CATALOG:
        try:
            _ensure_app_schema(APP_CATALOG)
            logger.info(f"App schema initialized in {APP_CATALOG}.{APP_SCHEMA}")
        except Exception as e:
            logger.warning(f"Startup schema init failed (will retry on first request): {e}")


# ---------------------------------------------------------------------------
# Health check — verifies all permissions
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    """Verify the app has all required permissions."""
    checks: dict[str, str] = {}
    errors: list[str] = []

    # 1. SQL warehouse connectivity
    try:
        _exec("SELECT 1 AS ping", max_rows=1)
        checks["sql_warehouse"] = "ok"
    except Exception as e:
        checks["sql_warehouse"] = f"FAIL: {e}"
        errors.append(f"SQL warehouse ({WAREHOUSE_ID}): {e}")

    # 2. Catalog access
    try:
        _exec("SHOW CATALOGS", max_rows=100)
        checks["show_catalogs"] = "ok"
    except Exception as e:
        checks["show_catalogs"] = f"FAIL: {e}"
        errors.append(f"SHOW CATALOGS: {e}")

    # 3. Schema browsing
    if APP_CATALOG:
        try:
            _exec(f"SHOW SCHEMAS IN `{APP_CATALOG}`", max_rows=100)
            checks["show_schemas"] = "ok"
        except Exception as e:
            checks["show_schemas"] = f"FAIL: {e}"
            errors.append(f"SHOW SCHEMAS in {APP_CATALOG}: {e}")

    # 4. App tables read/write
    for tbl_fn, label in [(_proj_fqn, "projects"), (_inv_fqn, "inventory"), (_log_fqn, "logs")]:
        try:
            _exec(f"SELECT COUNT(*) FROM {tbl_fn()}", max_rows=1)
            checks[f"app_table_{label}"] = "ok"
        except Exception as e:
            checks[f"app_table_{label}"] = f"FAIL: {e}"
            errors.append(f"App table {label}: {e}")

    # 5. ai_query (Foundation Model)
    try:
        _exec("SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', 'hi') AS r", max_rows=1)
        checks["ai_query"] = "ok"
    except Exception as e:
        checks["ai_query"] = f"WARN: {e}"
        # Not fatal — AI suggestions will fallback to heuristics

    status = "healthy" if not errors else "unhealthy"
    return {"status": status, "checks": checks, "errors": errors}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

IDENT_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")


def _validate(*names: str):
    for n in names:
        if not IDENT_RE.match(n):
            raise HTTPException(400, f"Invalid identifier: {n}")


def _fqn(catalog: str, schema: str, table: str) -> str:
    _validate(catalog, schema, table)
    return f"`{catalog}`.`{schema}`.`{table}`"


def _exec(sql: str, max_rows: int = 50000) -> dict:
    try:
        resp = w.statement_execution.execute_statement(
            warehouse_id=WAREHOUSE_ID,
            statement=sql,
            wait_timeout="50s",
            row_limit=max_rows,
        )
        if resp.status.state != StatementState.SUCCEEDED:
            err = resp.status.error.message if resp.status.error else "Unknown"
            # Provide user-friendly messages for common permission errors
            if "PERMISSION_DENIED" in err or "does not have" in err:
                logger.error(f"Permission error: {err}")
                raise HTTPException(403, f"Permission denied. The app service principal needs additional grants. Details: {err}")
            if "TABLE_OR_VIEW_NOT_FOUND" in err:
                logger.error(f"Table not found: {err}")
                raise HTTPException(404, f"Table or view not found. It may need to be created or the app needs access. Details: {err}")
            if "WAREHOUSE" in err.upper() or "warehouse" in err.lower():
                logger.error(f"Warehouse error: {err}")
                raise HTTPException(503, f"SQL warehouse issue. It may be stopped or unreachable. Details: {err}")
            raise HTTPException(500, f"SQL error: {err}")
        cols = [c.name for c in resp.manifest.schema.columns]
        rows = []
        if resp.result and resp.result.data_array:
            rows = [dict(zip(cols, r)) for r in resp.result.data_array]
        return {"columns": cols, "rows": rows}
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        if "PERMISSION_DENIED" in err_str:
            raise HTTPException(403, f"Permission denied: {err_str}")
        logger.exception("SQL execution failed")
        raise HTTPException(500, err_str)


def _safe_float(v):
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    except (ValueError, TypeError):
        return None


def _get_user(request: Request) -> str:
    return (
        request.headers.get("X-Forwarded-Email")
        or request.headers.get("X-Forwarded-User")
        or "unknown"
    )


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _escape_sql(s: str) -> str:
    return s.replace("'", "''")


NUMERIC_TYPES = {"int", "bigint", "smallint", "tinyint", "float", "double", "decimal", "long", "short"}


def _is_numeric(type_str: str) -> bool:
    return any(t in type_str.lower() for t in NUMERIC_TYPES)


# ---------------------------------------------------------------------------
# App schema setup
# ---------------------------------------------------------------------------

def _proj_fqn():
    return f"`{APP_CATALOG}`.`{APP_SCHEMA}`.feature_projects"


def _inv_fqn():
    return f"`{APP_CATALOG}`.`{APP_SCHEMA}`.feature_inventory"


def _log_fqn():
    return f"`{APP_CATALOG}`.`{APP_SCHEMA}`.feature_logs"


def _ensure_app_schema(catalog: str):
    global APP_CATALOG
    if not APP_CATALOG:
        APP_CATALOG = catalog
    _validate(APP_CATALOG)
    try:
        _exec(f"CREATE SCHEMA IF NOT EXISTS `{APP_CATALOG}`.`{APP_SCHEMA}`")
        _exec(f"""CREATE TABLE IF NOT EXISTS {_proj_fqn()} (
            project_id STRING,
            name STRING,
            description STRING,
            catalog STRING,
            schema_name STRING,
            source_table STRING,
            output_catalog STRING,
            output_schema STRING,
            output_table STRING,
            status STRING,
            created_by STRING,
            created_at STRING,
            updated_at STRING
        ) USING DELTA""")
        _exec(f"""CREATE TABLE IF NOT EXISTS {_inv_fqn()} (
            feature_id STRING,
            project_id STRING,
            source_catalog STRING,
            source_schema STRING,
            source_table STRING,
            rule_type STRING,
            rule_params STRING,
            output_column STRING,
            output_catalog STRING,
            output_schema STRING,
            output_table STRING,
            created_by STRING,
            created_at STRING,
            updated_at STRING,
            status STRING,
            approved_by STRING,
            approved_at STRING,
            notes STRING
        ) USING DELTA""")
        _exec(f"""CREATE TABLE IF NOT EXISTS {_log_fqn()} (
            log_id STRING,
            feature_id STRING,
            action STRING,
            actor STRING,
            action_time STRING,
            details STRING
        ) USING DELTA""")
    except Exception as e:
        logger.warning(f"App schema setup warning: {e}")


@app.post("/api/setup")
def setup_app_schema(request: Request):
    catalog = APP_CATALOG or "customer_segmentation"
    _ensure_app_schema(catalog)
    return {"status": "ok", "catalog": APP_CATALOG, "schema": APP_SCHEMA}


# ---------------------------------------------------------------------------
# Projects CRUD
# ---------------------------------------------------------------------------

class SourceTableRef(BaseModel):
    catalog: str
    schema_name: str
    table: str


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""
    catalog: str
    tables: list[SourceTableRef]
    output_table: str = ""


@app.post("/api/projects")
def create_project(req: CreateProjectRequest, request: Request):
    user = _get_user(request)
    _ensure_app_schema(req.catalog)
    project_id = str(uuid.uuid4())[:8]
    now = _now_str()
    first = req.tables[0] if req.tables else SourceTableRef(catalog=req.catalog, schema_name="default", table="unknown")
    out_table = req.output_table or f"{first.table}_features"
    name = _escape_sql(req.name)
    desc = _escape_sql(req.description)
    tables_json = _escape_sql(json.dumps([t.dict() for t in req.tables]))
    _exec(
        f"INSERT INTO {_proj_fqn()} (project_id, name, description, catalog, schema_name, source_table, "
        f"output_catalog, output_schema, output_table, status, created_by, created_at, updated_at, source_tables) VALUES ("
        f"'{project_id}', '{name}', '{desc}', "
        f"'{first.catalog}', '{first.schema_name}', '{first.table}', "
        f"'{req.catalog}', '{first.schema_name}', '{out_table}', "
        f"'ACTIVE', '{user}', '{now}', '{now}', '{tables_json}')"
    )
    return {"project_id": project_id, "name": req.name}


def _parse_source_tables(row: dict) -> list:
    """Parse source_tables JSON, fallback to single table fields."""
    st = row.get("source_tables")
    if st:
        try:
            return json.loads(st)
        except Exception:
            pass
    return [{"catalog": row.get("catalog", ""), "schema_name": row.get("schema_name", ""), "table": row.get("source_table", "")}]


@app.get("/api/projects")
def list_projects():
    try:
        r = _exec(f"SELECT * FROM {_proj_fqn()} WHERE status = 'ACTIVE' ORDER BY created_at DESC")
        for row in r["rows"]:
            row["tables"] = _parse_source_tables(row)
            try:
                cnt = _exec(
                    f"SELECT COUNT(*) AS cnt, "
                    f"SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved, "
                    f"SUM(CASE WHEN status = 'MATERIALIZED' THEN 1 ELSE 0 END) AS materialized "
                    f"FROM {_inv_fqn()} WHERE project_id = '{row['project_id']}'"
                )
                row["feature_count"] = int(cnt["rows"][0]["cnt"] or 0)
                row["approved_count"] = int(cnt["rows"][0]["approved"] or 0)
                row["materialized_count"] = int(cnt["rows"][0]["materialized"] or 0)
            except Exception:
                row["feature_count"] = 0
                row["approved_count"] = 0
                row["materialized_count"] = 0
        return r["rows"]
    except Exception:
        return []


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    _validate(project_id)
    r = _exec(f"SELECT * FROM {_proj_fqn()} WHERE project_id = '{project_id}'")
    if not r["rows"]:
        raise HTTPException(404, "Project not found")
    project = r["rows"][0]
    project["tables"] = _parse_source_tables(project)
    try:
        features = _exec(
            f"SELECT * FROM {_inv_fqn()} WHERE project_id = '{project_id}' ORDER BY created_at DESC"
        )
        project["features"] = features["rows"]
    except Exception:
        project["features"] = []
    return project


@app.delete("/api/projects/{project_id}")
def archive_project(project_id: str):
    _validate(project_id)
    _exec(
        f"UPDATE {_proj_fqn()} SET status = 'ARCHIVED', "
        f"updated_at = '{_now_str()}' WHERE project_id = '{project_id}'"
    )
    return {"status": "archived"}


# ---------------------------------------------------------------------------
# Catalog browsing
# ---------------------------------------------------------------------------

@app.get("/api/catalogs")
def list_catalogs():
    r = _exec("SHOW CATALOGS")
    return [row.get("catalog", row.get("catalog_name", "")) for row in r["rows"]]


@app.get("/api/schemas/{catalog}")
def list_schemas(catalog: str):
    _validate(catalog)
    r = _exec(f"SHOW SCHEMAS IN `{catalog}`")
    return [
        row.get("databaseName", row.get("schema_name", row.get("namespace", "")))
        for row in r["rows"]
    ]


@app.get("/api/tables/{catalog}/{schema}")
def list_tables(catalog: str, schema: str):
    _validate(catalog, schema)
    r = _exec(f"SHOW TABLES IN `{catalog}`.`{schema}`")
    return [
        {"name": row.get("tableName", row.get("table_name", "")),
         "type": row.get("tableType", row.get("table_type", ""))}
        for row in r["rows"]
    ]


@app.get("/api/table-info/{catalog}/{schema}/{table}")
def table_info(catalog: str, schema: str, table: str):
    fqn = _fqn(catalog, schema, table)
    desc = _exec(f"DESCRIBE TABLE {fqn}")
    cnt = _exec(f"SELECT COUNT(*) AS cnt FROM {fqn}")
    row_count = int(cnt["rows"][0]["cnt"]) if cnt["rows"] else 0
    columns = []
    for r in desc["rows"]:
        col_name = r.get("col_name", "")
        if col_name.startswith("#") or col_name == "" or col_name.startswith("Part "):
            continue
        columns.append({"name": col_name, "type": r.get("data_type", ""), "comment": r.get("comment", "")})
    return {"columns": columns, "rowCount": row_count}


@app.get("/api/table-preview/{catalog}/{schema}/{table}")
def table_preview(catalog: str, schema: str, table: str, limit: int = 100):
    fqn = _fqn(catalog, schema, table)
    r = _exec(f"SELECT * FROM {fqn} LIMIT {min(limit, 500)}")
    return {"columns": r["columns"], "rows": r["rows"]}


# ---------------------------------------------------------------------------
# Column values (for one-hot encoding UI)
# ---------------------------------------------------------------------------

@app.get("/api/column-values/{catalog}/{schema}/{table}/{column}")
def column_values(catalog: str, schema: str, table: str, column: str, limit: int = 50):
    fqn = _fqn(catalog, schema, table)
    _validate(column)
    cnt = _exec(f"SELECT COUNT(DISTINCT `{column}`) AS n FROM {fqn}")
    total_distinct = int(cnt["rows"][0]["n"]) if cnt["rows"] else 0
    r = _exec(
        f"SELECT CAST(`{column}` AS STRING) AS val, COUNT(*) AS cnt "
        f"FROM {fqn} GROUP BY 1 ORDER BY cnt DESC LIMIT {min(limit, 100)}"
    )
    total_rows = _exec(f"SELECT COUNT(*) AS n FROM {fqn}")
    total = int(total_rows["rows"][0]["n"]) if total_rows["rows"] else 0
    values = [
        {"value": row["val"] or "(null)", "count": int(row["cnt"]),
         "pct": round(int(row["cnt"]) / total * 100, 1) if total else 0}
        for row in r["rows"]
    ]
    return {"column": column, "totalDistinct": total_distinct, "totalRows": total, "values": values}


# ---------------------------------------------------------------------------
# EDA — Profiling
# ---------------------------------------------------------------------------

class ProfileRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str


@app.post("/api/eda/profile")
def eda_profile(req: ProfileRequest):
    fqn = _fqn(req.catalog, req.schema_name, req.table)
    info = table_info(req.catalog, req.schema_name, req.table)
    columns = info["columns"]
    row_count = info["rowCount"]
    if row_count == 0:
        return {"rowCount": 0, "colCount": len(columns), "columns": [], "alerts": []}

    parts_null = []
    parts_distinct = []
    for col in columns:
        cn = col["name"]
        parts_null.append(f"COUNT(*) - COUNT(`{cn}`) AS `null_{cn}`")
        parts_distinct.append(f"COUNT(DISTINCT `{cn}`) AS `dist_{cn}`")

    batch_sql = f"SELECT COUNT(*) AS total, {', '.join(parts_null + parts_distinct)} FROM {fqn}"
    batch_r = _exec(batch_sql)
    batch = batch_r["rows"][0] if batch_r["rows"] else {}

    num_cols = [c for c in columns if _is_numeric(c["type"])]
    num_stats = {}
    if num_cols:
        num_parts = []
        for col in num_cols:
            cn = col["name"]
            num_parts.extend([
                f"MIN(CAST(`{cn}` AS DOUBLE)) AS `min_{cn}`",
                f"MAX(CAST(`{cn}` AS DOUBLE)) AS `max_{cn}`",
                f"AVG(CAST(`{cn}` AS DOUBLE)) AS `mean_{cn}`",
                f"STDDEV(CAST(`{cn}` AS DOUBLE)) AS `std_{cn}`",
                f"PERCENTILE_APPROX(CAST(`{cn}` AS DOUBLE), 0.25) AS `q1_{cn}`",
                f"PERCENTILE_APPROX(CAST(`{cn}` AS DOUBLE), 0.5) AS `med_{cn}`",
                f"PERCENTILE_APPROX(CAST(`{cn}` AS DOUBLE), 0.75) AS `q3_{cn}`",
                f"SKEWNESS(CAST(`{cn}` AS DOUBLE)) AS `skew_{cn}`",
                f"KURTOSIS(CAST(`{cn}` AS DOUBLE)) AS `kurt_{cn}`",
            ])
        num_sql = f"SELECT {', '.join(num_parts)} FROM {fqn}"
        num_r = _exec(num_sql)
        num_stats = num_r["rows"][0] if num_r["rows"] else {}

    cat_cols = [c for c in columns if not _is_numeric(c["type"])][:15]
    cat_tops = {}
    for col in cat_cols:
        cn = col["name"]
        try:
            tv = _exec(
                f"SELECT CAST(`{cn}` AS STRING) AS val, COUNT(*) AS cnt "
                f"FROM {fqn} GROUP BY 1 ORDER BY cnt DESC LIMIT 10"
            )
            cat_tops[cn] = [
                {"value": r["val"] or "(null)", "count": int(r["cnt"]),
                 "pct": round(int(r["cnt"]) / row_count * 100, 1)}
                for r in tv["rows"]
            ]
        except Exception:
            cat_tops[cn] = []

    total_missing = 0
    alerts = []
    result_cols = []

    for col in columns:
        cn = col["name"]
        is_num = _is_numeric(col["type"])
        null_count = int(batch.get(f"null_{cn}") or 0)
        distinct_count = int(batch.get(f"dist_{cn}") or 0)
        null_pct = round(null_count / row_count * 100, 2)
        total_missing += null_count

        entry = {
            "name": cn,
            "type": col["type"],
            "isNumeric": is_num,
            "nullCount": null_count,
            "nullPct": null_pct,
            "distinctCount": distinct_count,
            "distinctPct": round(distinct_count / row_count * 100, 2),
        }

        if is_num:
            entry.update({
                "min": _safe_float(num_stats.get(f"min_{cn}")),
                "max": _safe_float(num_stats.get(f"max_{cn}")),
                "mean": _safe_float(num_stats.get(f"mean_{cn}")),
                "std": _safe_float(num_stats.get(f"std_{cn}")),
                "median": _safe_float(num_stats.get(f"med_{cn}")),
                "q1": _safe_float(num_stats.get(f"q1_{cn}")),
                "q3": _safe_float(num_stats.get(f"q3_{cn}")),
                "skewness": _safe_float(num_stats.get(f"skew_{cn}")),
                "kurtosis": _safe_float(num_stats.get(f"kurt_{cn}")),
            })
            skew = entry["skewness"]
            if skew is not None and abs(skew) > 2:
                alerts.append({"type": "skew", "column": cn, "message": f"Highly skewed ({skew})"})
        else:
            entry["topValues"] = cat_tops.get(cn, [])

        if null_pct > 5:
            alerts.append({"type": "missing", "column": cn, "message": f"{null_pct}% missing values"})
        if distinct_count == 1:
            alerts.append({"type": "constant", "column": cn, "message": "Constant value — consider dropping"})

        result_cols.append(entry)

    return {
        "rowCount": row_count,
        "colCount": len(columns),
        "numericCount": len(num_cols),
        "categoricalCount": len(cat_cols),
        "totalMissing": total_missing,
        "totalMissingPct": round(total_missing / (row_count * len(columns)) * 100, 2) if columns else 0,
        "columns": result_cols,
        "alerts": alerts,
    }


class DistributionRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    column: str
    bins: int = 20


@app.post("/api/eda/distribution")
def eda_distribution(req: DistributionRequest):
    fqn = _fqn(req.catalog, req.schema_name, req.table)
    _validate(req.column)
    info = table_info(req.catalog, req.schema_name, req.table)
    col_info = next((c for c in info["columns"] if c["name"] == req.column), None)
    if not col_info:
        raise HTTPException(404, f"Column {req.column} not found")

    is_num = _is_numeric(col_info["type"])

    if is_num:
        mm = _exec(
            f"SELECT MIN(CAST(`{req.column}` AS DOUBLE)) AS mn, "
            f"MAX(CAST(`{req.column}` AS DOUBLE)) AS mx FROM {fqn} "
            f"WHERE `{req.column}` IS NOT NULL"
        )
        mn, mx = float(mm["rows"][0]["mn"]), float(mm["rows"][0]["mx"])
        if mn == mx:
            return {"type": "numeric", "bins": [{"label": str(mn), "count": info["rowCount"]}]}
        width = (mx - mn) / req.bins
        sql = f"""
            SELECT FLOOR((CAST(`{req.column}` AS DOUBLE) - {mn}) / {width}) AS bin_idx, COUNT(*) AS cnt
            FROM {fqn} WHERE `{req.column}` IS NOT NULL GROUP BY 1 ORDER BY 1
        """
        r = _exec(sql)
        bins = []
        for row in r["rows"]:
            idx = int(float(row["bin_idx"])) if row["bin_idx"] is not None else 0
            lo = round(mn + idx * width, 2)
            hi = round(lo + width, 2)
            bins.append({"label": f"{lo}-{hi}", "count": int(row["cnt"])})
        return {"type": "numeric", "bins": bins}
    else:
        sql = f"""
            SELECT CAST(`{req.column}` AS STRING) AS val, COUNT(*) AS cnt
            FROM {fqn} GROUP BY 1 ORDER BY cnt DESC LIMIT 30
        """
        r = _exec(sql)
        return {"type": "categorical", "bins": [{"label": row["val"] or "(null)", "count": int(row["cnt"])} for row in r["rows"]]}


class CorrelationRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    columns: list[str]
    sample_size: int = 50000


@app.post("/api/eda/correlations")
def eda_correlations(req: CorrelationRequest):
    fqn = _fqn(req.catalog, req.schema_name, req.table)
    for c in req.columns:
        _validate(c)
    cols_sql = ", ".join(f"CAST(`{c}` AS DOUBLE) AS `{c}`" for c in req.columns)
    sql = f"SELECT {cols_sql} FROM {fqn} TABLESAMPLE ({min(req.sample_size, 50000)} ROWS)"
    r = _exec(sql, max_rows=req.sample_size)
    df = pd.DataFrame(r["rows"]).apply(pd.to_numeric, errors="coerce")
    corr = df.corr(method="pearson").fillna(0)
    vif_list = []
    clean = df.dropna()
    if len(clean) > 10 and len(req.columns) > 1:
        try:
            inv = np.linalg.inv(clean.corr().values)
            for i, col in enumerate(req.columns):
                vif_list.append({"column": col, "vif": round(float(inv[i, i]), 2)})
        except Exception:
            vif_list = [{"column": c, "vif": None} for c in req.columns]
    high_corr = []
    for i in range(len(req.columns)):
        for j in range(i + 1, len(req.columns)):
            val = abs(corr.iloc[i, j])
            if val > 0.8:
                high_corr.append({"col_a": req.columns[i], "col_b": req.columns[j], "value": round(float(corr.iloc[i, j]), 3)})
    return {
        "columns": req.columns,
        "matrix": [[round(v, 3) for v in row] for row in corr.values.tolist()],
        "vif": vif_list,
        "highCorrelations": high_corr,
    }


# ---------------------------------------------------------------------------
# Feature derivation
# ---------------------------------------------------------------------------

class FeatureRule(BaseModel):
    id: str = ""
    type: str
    params: dict
    outputColumn: str
    name: str = ""


class FeaturePreviewRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    rules: list[FeatureRule]


def _rule_to_sql(rule: FeatureRule) -> str:
    p = rule.params
    t = rule.type
    if t == "log":
        return f"LN(1 + ABS(CAST(`{p['column']}` AS DOUBLE)))"
    elif t == "sqrt":
        return f"SQRT(ABS(CAST(`{p['column']}` AS DOUBLE)))"
    elif t == "square":
        return f"POWER(CAST(`{p['column']}` AS DOUBLE), 2)"
    elif t == "bin_quantile":
        return f"NTILE({int(p['bins'])}) OVER (ORDER BY `{p['column']}`)"
    elif t == "bin_custom":
        breaks = sorted(p["breakpoints"])
        labels = p.get("labels", [f"bin_{i}" for i in range(len(breaks) + 1)])
        cases = []
        for i, b in enumerate(breaks):
            cases.append(f"WHEN CAST(`{p['column']}` AS DOUBLE) < {b} THEN '{labels[i]}'")
        cases.append(f"ELSE '{labels[-1] if labels else 'other'}'")
        return f"CASE {' '.join(cases)} END"
    elif t == "one_hot":
        return f"CASE WHEN CAST(`{p['column']}` AS STRING) = '{p['value']}' THEN 1 ELSE 0 END"
    elif t == "ratio":
        return f"CASE WHEN CAST(`{p['denominator']}` AS DOUBLE) = 0 THEN 0 ELSE CAST(`{p['numerator']}` AS DOUBLE) / CAST(`{p['denominator']}` AS DOUBLE) END"
    elif t == "difference":
        return f"CAST(`{p['column_a']}` AS DOUBLE) - CAST(`{p['column_b']}` AS DOUBLE)"
    elif t == "product":
        return f"CAST(`{p['column_a']}` AS DOUBLE) * CAST(`{p['column_b']}` AS DOUBLE)"
    elif t == "months_between":
        return f"MONTHS_BETWEEN(CAST(`{p['date_a']}` AS DATE), CAST(`{p['date_b']}` AS DATE))"
    elif t == "fillna":
        return f"COALESCE(`{p['column']}`, {p['value']})"
    elif t == "zscore":
        return f"(CAST(`{p['column']}` AS DOUBLE) - AVG(CAST(`{p['column']}` AS DOUBLE)) OVER ()) / NULLIF(STDDEV(CAST(`{p['column']}` AS DOUBLE)) OVER (), 0)"
    elif t == "minmax":
        return f"(CAST(`{p['column']}` AS DOUBLE) - MIN(CAST(`{p['column']}` AS DOUBLE)) OVER ()) / NULLIF(MAX(CAST(`{p['column']}` AS DOUBLE)) OVER () - MIN(CAST(`{p['column']}` AS DOUBLE)) OVER (), 0)"
    elif t == "log10":
        return f"LOG10(1 + ABS(CAST(`{p['column']}` AS DOUBLE)))"
    elif t == "inverse":
        return f"1.0 / NULLIF(CAST(`{p['column']}` AS DOUBLE), 0)"
    elif t == "inverse_square":
        return f"1.0 / NULLIF(POWER(CAST(`{p['column']}` AS DOUBLE), 2), 0)"
    elif t == "inverse_sqrt":
        return f"1.0 / NULLIF(SQRT(ABS(CAST(`{p['column']}` AS DOUBLE))), 0)"
    elif t == "centering":
        return f"CAST(`{p['column']}` AS DOUBLE) - AVG(CAST(`{p['column']}` AS DOUBLE)) OVER ()"
    elif t == "range_std":
        return f"(CAST(`{p['column']}` AS DOUBLE) - MIN(CAST(`{p['column']}` AS DOUBLE)) OVER ()) / NULLIF(MAX(CAST(`{p['column']}` AS DOUBLE)) OVER () - MIN(CAST(`{p['column']}` AS DOUBLE)) OVER (), 0)"
    elif t == "bucket_bin":
        mn = p.get("min", 0)
        mx = p.get("max", 1)
        bins = int(p.get("bins", 5))
        width = f"({mx} - {mn}) / {bins}"
        return f"LEAST(FLOOR((CAST(`{p['column']}` AS DOUBLE) - {mn}) / ({width})), {bins - 1})"
    elif t == "label_encode":
        return f"DENSE_RANK() OVER (ORDER BY `{p['column']}`)"
    elif t == "missing_indicator":
        return f"CASE WHEN `{p['column']}` IS NULL THEN 1 ELSE 0 END"
    elif t == "impute_mean":
        return f"COALESCE(CAST(`{p['column']}` AS DOUBLE), AVG(CAST(`{p['column']}` AS DOUBLE)) OVER ())"
    elif t == "impute_median":
        return f"COALESCE(`{p['column']}`, {p['value']})"
    elif t == "impute_mode":
        return f"COALESCE(CAST(`{p['column']}` AS STRING), '{p['value']}')"
    elif t == "impute_constant":
        return f"COALESCE(`{p['column']}`, {p['value']})"
    else:
        raise HTTPException(400, f"Unknown rule type: {t}")


@app.post("/api/feature/preview")
def feature_preview(req: FeaturePreviewRequest):
    fqn = _fqn(req.catalog, req.schema_name, req.table)
    derived = [f"{_rule_to_sql(r)} AS `{r.outputColumn}`" for r in req.rules]
    sql = f"SELECT *, {', '.join(derived)} FROM {fqn} LIMIT 100"
    return _exec(sql, max_rows=100)


class SuggestRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str


@app.post("/api/feature/suggest")
def feature_suggest(req: SuggestRequest):
    profile_data = eda_profile(ProfileRequest(catalog=req.catalog, schema_name=req.schema_name, table=req.table))
    columns = profile_data["columns"]
    alerts = profile_data.get("alerts", [])
    suggestions = []

    skewed_cols = {a["column"] for a in alerts if a["type"] == "skew"}
    missing_cols = {a["column"] for a in alerts if a["type"] == "missing"}

    num_cols = [c for c in columns if c["isNumeric"]]
    cat_cols = [c for c in columns if not c["isNumeric"]]

    for col in num_cols:
        cn = col["name"]
        if cn in skewed_cols:
            suggestions.append({
                "type": "log", "params": {"column": cn}, "outputColumn": f"{cn}_log",
                "name": f"Log Transform: {cn}_log",
                "reason": f"Column '{cn}' is highly skewed — log transform helps normalize the distribution",
            })
        if col.get("std") and col.get("mean") and col["mean"] != 0:
            cv = abs(col["std"] / col["mean"])
            if cv > 1.5:
                suggestions.append({
                    "type": "zscore", "params": {"column": cn}, "outputColumn": f"{cn}_zscore",
                    "name": f"Z-Score: {cn}_zscore",
                    "reason": f"High coefficient of variation ({cv:.1f}) — standardization recommended",
                })
        if col.get("min") is not None and col.get("max") is not None:
            rng = (col["max"] or 0) - (col["min"] or 0)
            if rng > 0 and cn not in skewed_cols:
                suggestions.append({
                    "type": "minmax", "params": {"column": cn}, "outputColumn": f"{cn}_scaled",
                    "name": f"Min-Max Scale: {cn}_scaled",
                    "reason": f"Range [{col['min']}, {col['max']}] — scaling to [0,1] for model compatibility",
                })
        if col.get("distinctCount", 0) > 20:
            suggestions.append({
                "type": "bin_quantile", "params": {"column": cn, "bins": 5}, "outputColumn": f"{cn}_bin",
                "name": f"Quantile Bin: {cn}_bin",
                "reason": f"{col['distinctCount']} distinct values — binning can capture non-linear effects",
            })
        if cn in missing_cols and col.get("median") is not None:
            suggestions.append({
                "type": "fillna", "params": {"column": cn, "value": str(col["median"])}, "outputColumn": f"{cn}_filled",
                "name": f"Fill Nulls: {cn}_filled",
                "reason": f"{col['nullPct']}% missing — filling with median ({col['median']})",
            })

    for col in cat_cols:
        cn = col["name"]
        distinct = col.get("distinctCount", 0)
        if 2 <= distinct <= 10:
            top_vals = col.get("topValues", [])
            for tv in top_vals[:5]:
                val = tv["value"]
                if val == "(null)":
                    continue
                safe_val = val.lower().replace(" ", "_").replace("-", "_")[:15]
                suggestions.append({
                    "type": "one_hot", "params": {"column": cn, "value": val}, "outputColumn": f"{cn}_{safe_val}",
                    "name": f"One-Hot: {cn}_{safe_val}",
                    "reason": f"Low cardinality ({distinct} values) — one-hot '{val}' ({tv['pct']}% of rows)",
                })
        if cn in missing_cols and col.get("topValues"):
            mode = col["topValues"][0]["value"]
            if mode != "(null)":
                suggestions.append({
                    "type": "fillna", "params": {"column": cn, "value": f"'{mode}'"}, "outputColumn": f"{cn}_filled",
                    "name": f"Fill Nulls: {cn}_filled",
                    "reason": f"{col['nullPct']}% missing — filling with mode ('{mode}')",
                })

    ratio_count = 0
    for i in range(len(num_cols)):
        if ratio_count >= 3:
            break
        for j in range(i + 1, len(num_cols)):
            if ratio_count >= 3:
                break
            a, b = num_cols[i]["name"], num_cols[j]["name"]
            suggestions.append({
                "type": "ratio", "params": {"numerator": a, "denominator": b}, "outputColumn": f"{a}_per_{b}",
                "name": f"Ratio: {a}_per_{b}",
                "reason": f"Ratio of {a} to {b} may capture meaningful relationships",
            })
            ratio_count += 1

    return {"suggestions": suggestions, "tableProfile": {"numericCount": len(num_cols), "categoricalCount": len(cat_cols), "rowCount": profile_data["rowCount"]}}


# ---------------------------------------------------------------------------
# AI Column-Specific Suggestions (uses ai_query for real LLM suggestions)
# ---------------------------------------------------------------------------

class ColumnSuggestRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    column: str
    existing_transforms: list[str] = []  # already-applied output columns


@app.post("/api/feature/suggest-column")
def suggest_column(req: ColumnSuggestRequest):
    """Use LLM (ai_query) to suggest transformations for a specific column."""
    _validate(req.catalog, req.schema_name, req.table, req.column)
    fqn = _fqn(req.catalog, req.schema_name, req.table)

    # 1) Get column profile
    profile_data = eda_profile(ProfileRequest(catalog=req.catalog, schema_name=req.schema_name, table=req.table))
    col_profile = None
    all_columns = []
    for c in profile_data["columns"]:
        all_columns.append(c["name"])
        if c["name"] == req.column:
            col_profile = c
    if not col_profile:
        raise HTTPException(404, f"Column '{req.column}' not found")

    # 2) Build concise profile summary for the LLM
    is_num = col_profile["isNumeric"]
    profile_desc = f"Column: {req.column}\nType: {col_profile['type']}\nNumeric: {is_num}\n"
    profile_desc += f"Null%: {col_profile['nullPct']}%  Distinct: {col_profile['distinctCount']}\n"
    if is_num:
        profile_desc += f"Min: {col_profile.get('min')}  Max: {col_profile.get('max')}  Mean: {col_profile.get('mean')}  Std: {col_profile.get('std')}\n"
        profile_desc += f"Skewness: {col_profile.get('skewness')}  Kurtosis: {col_profile.get('kurtosis')}\n"
    else:
        top_vals = col_profile.get("topValues", [])[:6]
        profile_desc += "Top values: " + ", ".join(f"'{v['value']}' ({v['pct']}%)" for v in top_vals) + "\n"

    other_num = [c for c in profile_data["columns"] if c["isNumeric"] and c["name"] != req.column]
    if is_num and other_num:
        profile_desc += f"Other numeric columns: {', '.join(c['name'] for c in other_num[:8])}\n"

    existing_str = ", ".join(req.existing_transforms) if req.existing_transforms else "None"

    # Available transform types
    if is_num:
        avail = "log, log10, sqrt, square, inverse, zscore, minmax, centering, range_std, bin_quantile, bucket_bin, impute_mean, impute_median, missing_indicator, ratio, difference, product"
    else:
        avail = "one_hot, label_encode, impute_mode, missing_indicator"

    prompt = f"""You are a feature engineering expert. Given this column profile from a data table, suggest the 2-4 BEST transformations.

{profile_desc}
Table: {fqn}
Already applied: {existing_str}
Available transform types: {avail}

For each suggestion return EXACTLY this JSON format (no markdown, no extra text):
[
  {{"type": "<transform_type>", "outputColumn": "<PREFIX_columnname>", "name": "<short label>", "reason": "<1 sentence: WHY this helps for modeling>", "params": {{"column": "{req.column}"}}}}
]

Use these prefixes: log→LOG_, log10→LOG10_, sqrt→SQRT_, square→SQR_, zscore→STD_, minmax→SCALED_, centering→CTR_, range_std→RNG_, bin_quantile→BIN_, bucket_bin→BKT_, one_hot→OH_, label_encode→LBL_, impute_mean→IMP_, impute_median→IMP_, impute_mode→IMP_, missing_indicator→M_, ratio→R_, difference→DIFF_, product→PROD_
For ratio/difference/product, pick a relevant second column from: {', '.join(c['name'] for c in other_num[:8]) if other_num else 'N/A'}
Do NOT suggest transforms already applied. Only suggest transforms that make statistical sense for this column's profile.
Return ONLY the JSON array, nothing else."""

    try:
        ai_sql = f"""SELECT ai_query(
            'databricks-meta-llama-3-3-70b-instruct',
            '{prompt.replace(chr(39), chr(39)+chr(39))}'
        ) AS response"""
        result = _exec(ai_sql, max_rows=1)
        raw = result["rows"][0]["response"] if result["rows"] else "[]"
        # Parse JSON from LLM response (may have markdown backticks)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
        suggestions = json.loads(raw)
        # Validate and clean
        clean = []
        for s in suggestions:
            if not isinstance(s, dict) or "type" not in s:
                continue
            if s.get("outputColumn") in req.existing_transforms:
                continue
            clean.append({
                "type": s.get("type", ""),
                "outputColumn": s.get("outputColumn", ""),
                "name": s.get("name", s.get("type", "")),
                "reason": s.get("reason", ""),
                "params": s.get("params", {"column": req.column}),
            })
        return {"suggestions": clean, "source": "ai"}
    except Exception as e:
        logger.warning(f"ai_query failed, falling back to heuristics: {e}")
        # Fallback to heuristic suggestions for this column
        return {"suggestions": _heuristic_column_suggest(col_profile, other_num, req.existing_transforms), "source": "heuristic"}


def _heuristic_column_suggest(col: dict, other_num: list, existing: list[str]) -> list:
    """Fallback heuristic suggestions for a single column."""
    cn = col["name"]
    suggestions = []

    if col["isNumeric"]:
        skew = col.get("skewness")
        if skew and abs(skew) > 1:
            out = f"LOG_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "log", "params": {"column": cn}, "outputColumn": out,
                    "name": f"Log Transform",
                    "reason": f"Skewness is {skew:.1f} — log transform will normalize the distribution",
                })
        std, mean = col.get("std"), col.get("mean")
        if std and mean and mean != 0 and abs(std / mean) > 1:
            out = f"STD_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "zscore", "params": {"column": cn}, "outputColumn": out,
                    "name": f"Z-Score Standardize",
                    "reason": f"High variance (CV={abs(std/mean):.1f}) — standardization helps model convergence",
                })
        if col.get("min") is not None and col.get("max") is not None:
            out = f"SCALED_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "minmax", "params": {"column": cn}, "outputColumn": out,
                    "name": f"Min-Max Scale",
                    "reason": f"Range [{col['min']}, {col['max']}] — scaling to [0,1] improves model compatibility",
                })
        if col.get("distinctCount", 0) > 20:
            out = f"BIN_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "bin_quantile", "params": {"column": cn, "bins": 5}, "outputColumn": out,
                    "name": f"Quantile Bin",
                    "reason": f"{col['distinctCount']} distinct values — binning captures non-linear patterns",
                })
        if col.get("nullPct", 0) > 0:
            out = f"IMP_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "impute_median", "params": {"column": cn}, "outputColumn": out,
                    "name": f"Impute Median",
                    "reason": f"{col['nullPct']}% missing — median imputation is robust to outliers",
                })
        if other_num:
            best = other_num[0]
            out = f"R_{cn}_{best['name']}"
            if out not in existing:
                suggestions.append({
                    "type": "ratio", "params": {"numerator": cn, "denominator": best["name"]}, "outputColumn": out,
                    "name": f"Ratio with {best['name']}",
                    "reason": f"Ratio may capture relative relationship between {cn} and {best['name']}",
                })
    else:
        distinct = col.get("distinctCount", 0)
        if 2 <= distinct <= 15:
            out = f"OH_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "one_hot", "params": {"column": cn, "drop_first": True}, "outputColumn": out,
                    "name": f"One-Hot Encode",
                    "reason": f"Low cardinality ({distinct} values) — one-hot encoding creates interpretable binary features",
                })
        out = f"LBL_{cn}"
        if out not in existing:
            suggestions.append({
                "type": "label_encode", "params": {"column": cn}, "outputColumn": out,
                "name": f"Label Encode",
                "reason": f"Integer mapping for categorical values ({distinct} distinct)",
            })
        if col.get("nullPct", 0) > 0:
            out = f"IMP_{cn}"
            if out not in existing:
                suggestions.append({
                    "type": "impute_mode", "params": {"column": cn}, "outputColumn": out,
                    "name": f"Impute Mode",
                    "reason": f"{col['nullPct']}% missing — fill with most frequent value",
                })

    return suggestions[:4]


# ---------------------------------------------------------------------------
# Inventory — CRUD + Approval Workflow
# ---------------------------------------------------------------------------

def _add_log(feature_id: str, action: str, actor: str, details: str = ""):
    log_id = str(uuid.uuid4())[:8]
    _exec(
        f"INSERT INTO {_log_fqn()} VALUES ("
        f"'{log_id}', '{feature_id}', '{action}', '{actor}', '{_now_str()}', '{_escape_sql(details)}')"
    )


class InventorySubmitRequest(BaseModel):
    project_id: str = ""
    source_catalog: str
    source_schema: str
    source_table: str
    output_catalog: str
    output_schema: str
    output_table: str
    rules: list[FeatureRule]
    notes: str = ""


@app.post("/api/inventory/submit")
def inventory_submit(req: InventorySubmitRequest, request: Request):
    user = _get_user(request)
    _ensure_app_schema(req.source_catalog)
    now = _now_str()
    ids = []

    for rule in req.rules:
        fid = str(uuid.uuid4())[:8]
        params_json = json.dumps(rule.params).replace("'", "\\'")
        _exec(
            f"INSERT INTO {_inv_fqn()} VALUES ("
            f"'{fid}', '{req.project_id}', '{req.source_catalog}', '{req.source_schema}', '{req.source_table}', "
            f"'{rule.type}', '{params_json}', '{rule.outputColumn}', "
            f"'{req.output_catalog}', '{req.output_schema}', '{req.output_table}', "
            f"'{user}', '{now}', '{now}', 'PENDING_APPROVAL', NULL, NULL, "
            f"'{_escape_sql(req.notes)}')"
        )
        _add_log(fid, "SUBMITTED", user, f"Rule: {rule.type} -> {rule.outputColumn}")
        ids.append(fid)

    return {"status": "submitted", "featureIds": ids, "count": len(ids)}


@app.get("/api/inventory")
def inventory_list(project_id: Optional[str] = None):
    try:
        where = f"WHERE project_id = '{project_id}'" if project_id else ""
        r = _exec(f"SELECT * FROM {_inv_fqn()} {where} ORDER BY created_at DESC")
        return r["rows"]
    except Exception:
        return []


class ApprovalRequest(BaseModel):
    feature_id: str
    notes: str = ""


@app.post("/api/inventory/approve")
def inventory_approve(req: ApprovalRequest, request: Request):
    user = _get_user(request)
    now = _now_str()
    _exec(
        f"UPDATE {_inv_fqn()} SET status = 'APPROVED', approved_by = '{user}', "
        f"approved_at = '{now}', updated_at = '{now}' WHERE feature_id = '{req.feature_id}'"
    )
    _add_log(req.feature_id, "APPROVED", user, req.notes)
    return {"status": "approved", "feature_id": req.feature_id}


@app.post("/api/inventory/reject")
def inventory_reject(req: ApprovalRequest, request: Request):
    user = _get_user(request)
    now = _now_str()
    _exec(
        f"UPDATE {_inv_fqn()} SET status = 'REJECTED', "
        f"updated_at = '{now}' WHERE feature_id = '{req.feature_id}'"
    )
    _add_log(req.feature_id, "REJECTED", user, req.notes)
    return {"status": "rejected", "feature_id": req.feature_id}


class MaterializeRequest(BaseModel):
    output_catalog: str
    output_schema: str
    output_table: str


@app.post("/api/inventory/materialize")
def inventory_materialize(req: MaterializeRequest, request: Request):
    user = _get_user(request)
    r = _exec(
        f"SELECT * FROM {_inv_fqn()} WHERE status = 'APPROVED' "
        f"AND output_catalog = '{req.output_catalog}' "
        f"AND output_schema = '{req.output_schema}' "
        f"AND output_table = '{req.output_table}'"
    )
    if not r["rows"]:
        raise HTTPException(400, "No approved features for this target table")

    source_tables = {}
    for row in r["rows"]:
        src_key = f"{row['source_catalog']}.{row['source_schema']}.{row['source_table']}"
        if src_key not in source_tables:
            source_tables[src_key] = {"fqn": _fqn(row["source_catalog"], row["source_schema"], row["source_table"]), "rules": []}
        rule = FeatureRule(
            type=row["rule_type"],
            params=json.loads(row["rule_params"]),
            outputColumn=row["output_column"],
        )
        source_tables[src_key]["rules"].append(rule)

    if len(source_tables) > 1:
        raise HTTPException(400, "Multi-source materialization not yet supported. Submit features from one source table at a time.")

    src_key, src_info = list(source_tables.items())[0]
    derived = [f"{_rule_to_sql(rule)} AS `{rule.outputColumn}`" for rule in src_info["rules"]]
    out_fqn = _fqn(req.output_catalog, req.output_schema, req.output_table)
    derived_clause = f", {', '.join(derived)}" if derived else ""
    _exec(f"CREATE OR REPLACE TABLE {out_fqn} AS SELECT *{derived_clause} FROM {src_info['fqn']}")

    cnt = _exec(f"SELECT COUNT(*) AS cnt FROM {out_fqn}")
    row_count = int(cnt["rows"][0]["cnt"]) if cnt["rows"] else 0

    for row in r["rows"]:
        _exec(f"UPDATE {_inv_fqn()} SET status = 'MATERIALIZED', updated_at = '{_now_str()}' WHERE feature_id = '{row['feature_id']}'")
        _add_log(row["feature_id"], "MATERIALIZED", user, f"Written to {req.output_catalog}.{req.output_schema}.{req.output_table}")

    return {"status": "materialized", "table": f"{req.output_catalog}.{req.output_schema}.{req.output_table}", "rowCount": row_count}


@app.get("/api/inventory/logs")
def inventory_logs(feature_id: Optional[str] = None):
    try:
        where = f"WHERE feature_id = '{feature_id}'" if feature_id else ""
        r = _exec(f"SELECT * FROM {_log_fqn()} {where} ORDER BY action_time DESC LIMIT 200")
        return r["rows"]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Feature detail (deep dive)
# ---------------------------------------------------------------------------

@app.get("/api/features/{feature_id}")
def feature_detail(feature_id: str):
    _validate(feature_id)
    r = _exec(f"SELECT * FROM {_inv_fqn()} WHERE feature_id = '{feature_id}'")
    if not r["rows"]:
        raise HTTPException(404, "Feature not found")
    feature = r["rows"][0]
    # Logs
    logs_r = _exec(f"SELECT * FROM {_log_fqn()} WHERE feature_id = '{feature_id}' ORDER BY action_time DESC")
    feature["logs"] = logs_r["rows"]
    # Project info
    if feature.get("project_id"):
        try:
            proj = _exec(f"SELECT * FROM {_proj_fqn()} WHERE project_id = '{feature['project_id']}'")
            if proj["rows"]:
                feature["project"] = proj["rows"][0]
        except Exception:
            pass
    # SQL expression
    try:
        rule = FeatureRule(
            type=feature["rule_type"],
            params=json.loads(feature["rule_params"]),
            outputColumn=feature["output_column"],
        )
        feature["sql_expression"] = _rule_to_sql(rule)
    except Exception:
        feature["sql_expression"] = ""
    return feature


# ---------------------------------------------------------------------------
# Segmentation / Clustering
# ---------------------------------------------------------------------------

class SegmentRunRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    algorithm: str = "kmeans"
    k: Optional[int] = 5
    eps: Optional[float] = 0.5
    min_samples: Optional[int] = 5
    features: Optional[List[str]] = None


class KpiLensRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    kpi_column: str
    point_ids: Optional[List[str]] = None


class PersonaRequest(BaseModel):
    cluster_id: int
    feature_means: dict
    size: int
    percentage: float
    table_name: Optional[str] = None


class StrategiesRequest(BaseModel):
    cluster_id: int
    feature_means: dict
    size: int
    percentage: float
    table_name: Optional[str] = None
    kpi_name: Optional[str] = None


class CompareRequest(BaseModel):
    cluster_a: int
    cluster_b: int
    clusters: List[dict]
    table_name: Optional[str] = None


class SplitRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    cluster_id: int
    current_labels: List[int]
    current_points: List[List[float]]
    sub_k: Optional[int] = 2


class MergeRequest(BaseModel):
    merge_from: List[int]
    merge_to: int
    current_labels: List[int]


@app.post("/api/segment/run")
def segment_run(req: SegmentRunRequest):
    """Run clustering on a table's numeric columns with UMAP 2D projection."""
    try:
        _validate(req.catalog, req.schema_name, req.table)
        fqn = _fqn(req.catalog, req.schema_name, req.table)

        # Discover numeric columns
        desc = _exec(f"DESCRIBE TABLE {fqn}")
        numeric_cols = []
        for row in desc["rows"]:
            col_name = row.get("col_name", "")
            data_type = row.get("data_type", "").lower()
            if any(t in data_type for t in NUMERIC_TYPES):
                numeric_cols.append(col_name)

        if req.features:
            numeric_cols = [c for c in req.features if c in numeric_cols]
        if not numeric_cols:
            raise HTTPException(400, "No numeric columns found for clustering")

        # Pull data (subsample to 10k)
        col_list = ", ".join(f"`{c}`" for c in numeric_cols)
        data = _exec(f"SELECT {col_list} FROM {fqn} LIMIT 10000", max_rows=10000)
        if not data["rows"]:
            raise HTTPException(400, "Table is empty")

        df = pd.DataFrame(data["rows"], columns=numeric_cols).apply(pd.to_numeric, errors="coerce")
        df = df.dropna()
        if len(df) < 10:
            raise HTTPException(400, f"Only {len(df)} valid rows after dropping nulls; need at least 10")

        # Scale features
        scaler = StandardScaler()
        X = scaler.fit_transform(df.values)

        # Cluster
        if req.algorithm == "dbscan":
            model = DBSCAN(eps=req.eps or 0.5, min_samples=req.min_samples or 5)
            labels = model.fit_predict(X)
        else:
            k = min(req.k or 5, len(df))
            model = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = model.fit_predict(X)

        # UMAP 2D projection
        n_neighbors = min(15, len(df) - 1)
        reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=n_neighbors)
        embedding = reducer.fit_transform(X)

        # Silhouette score (skip if only 1 cluster or all same label)
        unique_labels = set(labels)
        unique_labels.discard(-1)
        sil = None
        if len(unique_labels) > 1:
            try:
                sil = float(silhouette_score(X, labels))
            except Exception:
                sil = None

        # Build points list
        points = []
        for i in range(len(df)):
            points.append({
                "x": _safe_float(embedding[i, 0]),
                "y": _safe_float(embedding[i, 1]),
                "cluster": int(labels[i]),
                "index": i,
            })

        # Per-cluster stats
        df["_cluster"] = labels
        # Compute global means for top-feature detection
        global_means = {c: _safe_float(df[c].mean()) for c in numeric_cols}
        global_stds = {c: max(_safe_float(df[c].std()), 1e-9) for c in numeric_cols}

        cluster_stats = []
        total = len(df)
        for cid in sorted(unique_labels):
            mask = df["_cluster"] == cid
            subset = df.loc[mask, numeric_cols]
            size = int(mask.sum())
            feature_means = {}
            deviations = {}
            for c in numeric_cols:
                m = _safe_float(subset[c].mean())
                feature_means[c] = m
                deviations[c] = abs(m - global_means[c]) / global_stds[c]
            # Top features: those that deviate most from global mean
            top_features = sorted(deviations, key=lambda x: deviations[x], reverse=True)[:5]
            cluster_stats.append({
                "cluster_id": int(cid),
                "size": size,
                "percentage": round(size / total * 100, 1) if total else 0,
                "feature_means": feature_means,
                "top_features": top_features,
            })

        return {
            "points": points,
            "clusters": cluster_stats,
            "silhouette_score": _safe_float(sil) if sil is not None else 0.0,
            "n_clusters": len(unique_labels),
            "feature_names": numeric_cols,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Segment run failed")
        raise HTTPException(500, f"Clustering failed: {e}")


@app.post("/api/segment/kpi-lens")
def segment_kpi_lens(req: KpiLensRequest):
    """Pull a KPI column's values for overlay analysis."""
    try:
        _validate(req.catalog, req.schema_name, req.table, req.kpi_column)
        fqn = _fqn(req.catalog, req.schema_name, req.table)

        sql = f"SELECT `{req.kpi_column}` FROM {fqn} LIMIT 10000"
        data = _exec(sql, max_rows=10000)
        if not data["rows"]:
            raise HTTPException(400, "No data returned")

        values = []
        for row in data["rows"]:
            v = _safe_float(row.get(req.kpi_column))
            if v is not None:
                values.append(v)

        if not values:
            raise HTTPException(400, "No numeric values found in KPI column")

        return {
            "values": values,
            "kpi_column": req.kpi_column,
            "min": min(values),
            "max": max(values),
            "mean": _safe_float(sum(values) / len(values)),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("KPI lens failed")
        raise HTTPException(500, f"KPI lens failed: {e}")


@app.post("/api/segment/persona")
def segment_persona(req: PersonaRequest):
    """Generate an AI first-person persona narrative for a cluster."""
    try:
        pct = req.percentage
        stats_str = json.dumps(req.feature_means, default=str)

        prompt = (
            f"You are a data analyst creating customer personas. "
            f"Cluster {req.cluster_id} contains {req.size} customers ({pct}% of total). "
            f"Here are the cluster average statistics: {stats_str}. "
            f"Write a 3-4 sentence first-person narrative AS IF you ARE this customer. "
            f"Include key traits, behaviors, and motivations. "
            f"Start with 'I am...' and make it vivid and specific. Do not use bullet points."
        )

        rows = _exec(
            f"SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', '{prompt.replace(chr(39), chr(39)+chr(39))}') AS result",
            max_rows=1,
        )
        result = rows["rows"][0]["result"] if rows["rows"] else "Unable to generate persona."

        return {"persona": result, "cluster_id": req.cluster_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Persona generation failed")
        raise HTTPException(500, f"Persona generation failed: {e}")


@app.post("/api/segment/strategies")
def segment_strategies(req: StrategiesRequest):
    """Generate AI-powered marketing strategies for a cluster."""
    try:
        stats_str = json.dumps(req.feature_means, default=str)
        kpi_part = f" The key business KPI is '{req.kpi_name}'." if req.kpi_name else ""

        prompt = (
            f"You are a marketing strategist. Given a customer segment (Cluster {req.cluster_id}) "
            f"with these average statistics: {stats_str}.{kpi_part} "
            f"Generate 3-5 actionable marketing strategies for this segment. "
            f"Return a JSON array where each element has: "
            f"\"title\" (short), \"description\" (1-2 sentences), "
            f"\"expected_impact\" (1 sentence), \"priority\" (\"high\", \"medium\", or \"low\"). "
            f"Return ONLY the JSON array, no other text."
        )

        rows = _exec(
            f"SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', '{prompt.replace(chr(39), chr(39)+chr(39))}') AS result",
            max_rows=1,
        )
        raw = rows["rows"][0]["result"] if rows["rows"] else "[]"

        # Parse the JSON response
        try:
            strategies = json.loads(raw)
            if not isinstance(strategies, list):
                strategies = []
        except json.JSONDecodeError:
            # Try to extract JSON array from response
            match = re.search(r"\[.*\]", raw, re.DOTALL)
            if match:
                try:
                    strategies = json.loads(match.group())
                except json.JSONDecodeError:
                    strategies = []
            else:
                strategies = []

        return {"strategies": strategies, "cluster_id": req.cluster_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Strategy generation failed")
        raise HTTPException(500, f"Strategy generation failed: {e}")


@app.post("/api/segment/compare")
def segment_compare(req: CompareRequest):
    """Generate an AI comparison of two clusters."""
    try:
        # Find the two clusters from the array
        cluster_a_data = next((c for c in req.clusters if c.get("cluster_id") == req.cluster_a), None)
        cluster_b_data = next((c for c in req.clusters if c.get("cluster_id") == req.cluster_b), None)

        if not cluster_a_data or not cluster_b_data:
            raise HTTPException(400, "Cluster data not found")

        means_a = cluster_a_data.get("feature_means", {})
        means_b = cluster_b_data.get("feature_means", {})

        # Compute differences directly
        differences = []
        for feat in means_a:
            va = _safe_float(means_a.get(feat, 0)) or 0
            vb = _safe_float(means_b.get(feat, 0)) or 0
            differences.append({
                "feature": feat,
                "cluster_a_value": round(va, 3),
                "cluster_b_value": round(vb, 3),
                "delta": round(vb - va, 3),
            })
        # Sort by absolute delta descending
        differences.sort(key=lambda d: abs(d["delta"]), reverse=True)

        # AI summary
        prompt = (
            f"You are a data analyst comparing two customer segments. "
            f"Cluster {req.cluster_a} ({cluster_a_data.get('size', '?')} customers, {cluster_a_data.get('percentage', '?')}%): means = {json.dumps(means_a, default=str)}. "
            f"Cluster {req.cluster_b} ({cluster_b_data.get('size', '?')} customers, {cluster_b_data.get('percentage', '?')}%): means = {json.dumps(means_b, default=str)}. "
            f"Write a concise 2-3 sentence comparison highlighting the key differences. No bullet points."
        )

        try:
            rows = _exec(
                f"SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', '{prompt.replace(chr(39), chr(39)+chr(39))}') AS result",
                max_rows=1,
            )
            summary = rows["rows"][0]["result"] if rows["rows"] else "Unable to generate comparison."
        except Exception:
            summary = f"Cluster {req.cluster_a} and Cluster {req.cluster_b} differ most in {differences[0]['feature']} (delta: {differences[0]['delta']})." if differences else "No comparison available."

        return {
            "summary": summary,
            "differences": differences[:10],
            "cluster_a": req.cluster_a,
            "cluster_b": req.cluster_b,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Comparison generation failed")
        raise HTTPException(500, f"Comparison failed: {e}")


@app.post("/api/segment/split")
def segment_split(req: SplitRequest):
    """Re-cluster a specific cluster's points into sub-clusters."""
    try:
        labels = np.array(req.current_labels)
        points = np.array(req.current_points)

        mask = labels == req.cluster_id
        if mask.sum() < 2:
            raise HTTPException(400, "Cluster has fewer than 2 points; cannot split")

        subset_points = points[mask]
        subset_indices = np.where(mask)[0]

        sub_k = min(req.sub_k or 2, len(subset_points))
        sub_model = KMeans(n_clusters=sub_k, random_state=42, n_init=10)
        sub_labels = sub_model.fit_predict(subset_points)

        # Remap sub-labels to new global IDs (max existing + 1, +2, ...)
        max_label = int(labels.max()) + 1
        new_labels = labels.copy()
        for sub_id in range(sub_k):
            sub_mask = sub_labels == sub_id
            global_indices = subset_indices[sub_mask]
            if sub_id == 0:
                # Keep the original cluster ID for the first sub-cluster
                new_labels[global_indices] = req.cluster_id
            else:
                new_labels[global_indices] = max_label
                max_label += 1

        # Rebuild points with updated labels
        result_points = []
        for i in range(len(points)):
            result_points.append({
                "x": _safe_float(points[i, 0]),
                "y": _safe_float(points[i, 1]),
                "cluster": int(new_labels[i]),
                "id": i,
            })

        # Compute new cluster stats from the subset using original features
        # Pull data again for stats if we have the table info
        _validate(req.catalog, req.schema_name, req.table)
        fqn = _fqn(req.catalog, req.schema_name, req.table)
        desc = _exec(f"DESCRIBE TABLE {fqn}")
        numeric_cols = []
        for row in desc["rows"]:
            col_name = row.get("col_name", "")
            data_type = row.get("data_type", "").lower()
            if any(t in data_type for t in NUMERIC_TYPES):
                numeric_cols.append(col_name)

        col_list = ", ".join(f"`{c}`" for c in numeric_cols)
        data = _exec(f"SELECT {col_list} FROM {fqn} LIMIT 10000", max_rows=10000)
        df = pd.DataFrame(data["rows"], columns=numeric_cols).apply(pd.to_numeric, errors="coerce").dropna()
        # Trim to match labels length
        df = df.iloc[:len(new_labels)]
        df["_cluster"] = new_labels[:len(df)]

        unique_labels = set(int(l) for l in new_labels)
        unique_labels.discard(-1)
        total = len(df)
        cluster_stats = []
        for cid in sorted(unique_labels):
            mask_c = df["_cluster"] == cid
            subset_c = df.loc[mask_c, numeric_cols]
            size = int(mask_c.sum())
            means = {}
            for c in numeric_cols:
                means[c] = _safe_float(subset_c[c].mean())
            cluster_stats.append({
                "cluster_id": int(cid),
                "size": size,
                "pct": round(size / total * 100, 1) if total else 0,
                "means": means,
            })

        sil = None
        if len(unique_labels) > 1:
            try:
                sil = float(silhouette_score(points, new_labels))
            except Exception:
                sil = None

        return {
            "points": result_points,
            "clusterStats": cluster_stats,
            "metrics": {
                "silhouette": _safe_float(sil),
                "n_clusters": len(unique_labels),
                "n_points": total,
            },
            "features": numeric_cols,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Split failed")
        raise HTTPException(500, f"Split failed: {e}")


@app.post("/api/segment/merge")
def segment_merge(req: MergeRequest):
    """Merge multiple clusters into one by reassigning labels."""
    try:
        labels = list(req.current_labels)
        for i in range(len(labels)):
            if labels[i] in req.merge_from:
                labels[i] = req.merge_to
        return {"labels": labels}
    except Exception as e:
        logger.exception("Merge failed")
        raise HTTPException(500, f"Merge failed: {e}")


# ---------------------------------------------------------------------------
# NeuralLift-style endpoints: KPI Lift, Context, Actions
# ---------------------------------------------------------------------------

class KpiLiftRequest(BaseModel):
    catalog: str
    schema_name: str
    table: str
    kpi_column: str
    cluster_assignments: List[int]  # cluster label per row (parallel to the 10K rows)


class ContextRequest(BaseModel):
    cluster_id: int
    feature_means: dict  # this cluster's feature means
    all_clusters: List[dict]  # all cluster summaries
    table_name: Optional[str] = None


class ActionsRequest(BaseModel):
    cluster_id: int
    feature_means: dict
    kpi_lifts: Optional[dict] = None  # {kpi_column: lift_pct}
    context_summary: Optional[str] = None
    table_name: Optional[str] = None


@app.post("/api/segment/kpi-lift")
def segment_kpi_lift(req: KpiLiftRequest):
    """Compute KPI lift per cluster — how each cluster over/under-indexes vs global mean."""
    try:
        _validate(req.catalog, req.schema_name, req.table, req.kpi_column)
        fqn = _fqn(req.catalog, req.schema_name, req.table)

        sql = f"SELECT `{req.kpi_column}` FROM {fqn} LIMIT 10000"
        data = _exec(sql, max_rows=10000)
        if not data["rows"]:
            raise HTTPException(400, "No data returned")

        values = []
        for row in data["rows"]:
            v = _safe_float(row.get(req.kpi_column))
            values.append(v if v is not None else 0.0)

        if not values:
            raise HTTPException(400, "No values found in KPI column")

        labels = req.cluster_assignments
        if len(labels) != len(values):
            # Trim to the shorter of the two
            min_len = min(len(labels), len(values))
            labels = labels[:min_len]
            values = values[:min_len]

        global_mean = sum(values) / len(values) if values else 0.0
        total = len(values)

        # Group by cluster
        cluster_data: dict[int, list] = {}
        for i, lbl in enumerate(labels):
            cluster_data.setdefault(lbl, []).append(values[i])

        cluster_lifts = []
        for cid, cvals in cluster_data.items():
            cluster_mean = sum(cvals) / len(cvals) if cvals else 0.0
            size = len(cvals)
            size_pct = round(size / total * 100, 1) if total else 0.0
            lift_pct = round((cluster_mean - global_mean) / global_mean * 100, 2) if global_mean != 0 else 0.0
            opportunity_score = round(lift_pct * size_pct / 100, 2)
            direction = "over" if lift_pct >= 0 else "under"
            cluster_lifts.append({
                "cluster_id": int(cid),
                "cluster_mean": round(cluster_mean, 4),
                "lift_pct": lift_pct,
                "size": size,
                "size_pct": size_pct,
                "opportunity_score": opportunity_score,
                "direction": direction,
            })

        # Sort by absolute lift descending
        cluster_lifts.sort(key=lambda x: abs(x["lift_pct"]), reverse=True)

        return {
            "kpi_column": req.kpi_column,
            "global_mean": round(global_mean, 4),
            "cluster_lifts": cluster_lifts,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("KPI lift computation failed")
        raise HTTPException(500, f"KPI lift failed: {e}")


@app.post("/api/segment/context")
def segment_context(req: ContextRequest):
    """Generate rich context for a cluster — summary, feature comparison, importance."""
    try:
        # Compute out-of-segment means (all other clusters combined)
        in_means = req.feature_means
        out_counts = {}
        out_sums = {}
        for cl in req.all_clusters:
            if cl.get("cluster_id") == req.cluster_id:
                continue
            cl_means = cl.get("feature_means", {})
            cl_size = cl.get("size", 0)
            for feat, val in cl_means.items():
                v = _safe_float(val) or 0.0
                out_sums[feat] = out_sums.get(feat, 0.0) + v * cl_size
                out_counts[feat] = out_counts.get(feat, 0) + cl_size

        # Build feature comparison
        defining_features = []
        for feat, in_val in in_means.items():
            in_v = _safe_float(in_val) or 0.0
            out_v = (out_sums.get(feat, 0.0) / out_counts[feat]) if out_counts.get(feat, 0) > 0 else 0.0
            index_val = round((in_v / out_v) * 100, 1) if out_v != 0 else (999.9 if in_v > 0 else 100.0)

            if index_val > 150 or index_val < 50:
                importance = "high"
            elif index_val > 120 or index_val < 80:
                importance = "medium"
            else:
                importance = "low"

            defining_features.append({
                "feature": feat,
                "in_segment": round(in_v, 4),
                "out_segment": round(out_v, 4),
                "index": index_val,
                "importance": importance,
            })

        # Sort by deviation from 100 (most distinctive first)
        defining_features.sort(key=lambda x: abs(x["index"] - 100), reverse=True)

        # Build feature comparison string for the LLM prompt
        feat_comparison = "; ".join(
            f"{f['feature']}: in-segment={f['in_segment']}, out-segment={f['out_segment']}, index={f['index']}"
            for f in defining_features[:10]
        )

        table_part = f" from the table '{req.table_name}'" if req.table_name else ""
        prompt = (
            f"You are a data analyst building customer segments{table_part}. "
            f"Cluster {req.cluster_id} has these feature comparisons (in-segment vs out-of-segment): {feat_comparison}. "
            f"An index of 100 means equal to the rest; above 100 means over-indexing; below 100 means under-indexing. "
            f"Respond with ONLY a JSON object (no markdown, no backticks) with two keys: "
            f"\"segment_label\" (a concise 2-3 word label like \"High-Value Dormant\" or \"Young Digital Active\") and "
            f"\"context_summary\" (2-3 sentences explaining WHO these customers are and what makes them unique). "
            f"Return ONLY the JSON object."
        )

        segment_label = f"Cluster {req.cluster_id}"
        context_summary = ""

        try:
            rows = _exec(
                f"SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', '{prompt.replace(chr(39), chr(39)+chr(39))}') AS result",
                max_rows=1,
            )
            raw = rows["rows"][0]["result"] if rows["rows"] else "{}"
            try:
                parsed = json.loads(raw)
                segment_label = parsed.get("segment_label", segment_label)
                context_summary = parsed.get("context_summary", "")
            except json.JSONDecodeError:
                # Try extracting JSON from response
                match = re.search(r"\{.*\}", raw, re.DOTALL)
                if match:
                    try:
                        parsed = json.loads(match.group())
                        segment_label = parsed.get("segment_label", segment_label)
                        context_summary = parsed.get("context_summary", "")
                    except json.JSONDecodeError:
                        context_summary = raw
                else:
                    context_summary = raw
        except Exception as ai_err:
            logger.warning(f"ai_query failed for context, using fallback: {ai_err}")
            top = defining_features[:3] if defining_features else []
            traits = ", ".join(f"{f['feature']} (index {f['index']})" for f in top)
            context_summary = f"This segment is distinguished by: {traits}."

        return {
            "cluster_id": req.cluster_id,
            "context_summary": context_summary,
            "defining_features": defining_features,
            "segment_label": segment_label,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Context generation failed")
        raise HTTPException(500, f"Context generation failed: {e}")


@app.post("/api/segment/actions")
def segment_actions(req: ActionsRequest):
    """Generate prescriptive actions with expected KPI impact for a cluster."""
    try:
        stats_str = json.dumps(req.feature_means, default=str)
        kpi_part = ""
        if req.kpi_lifts:
            kpi_parts = [f"{k}: {v:+.1f}% lift" for k, v in req.kpi_lifts.items()]
            kpi_part = f" KPI performance: {', '.join(kpi_parts)}."
        context_part = f" Segment context: {req.context_summary}" if req.context_summary else ""
        table_part = f" from the table '{req.table_name}'" if req.table_name else ""

        prompt = (
            f"You are a marketing strategist analyzing customer segments{table_part}. "
            f"Cluster {req.cluster_id} has these average feature values: {stats_str}.{kpi_part}{context_part} "
            f"Generate 4-5 prescriptive actions to improve business outcomes for this segment. "
            f"Return ONLY a JSON array (no markdown, no backticks) where each element has: "
            f"\"title\" (short action name), "
            f"\"description\" (1-2 sentences on what to do), "
            f"\"target_kpi\" (which business metric this targets, e.g. revenue, retention, engagement), "
            f"\"expected_lift\" (e.g. \"+15% revenue\" or \"+20% retention\"), "
            f"\"priority\" (\"high\", \"medium\", or \"low\"), "
            f"\"effort\" (\"low\", \"medium\", or \"high\"). "
            f"Return ONLY the JSON array."
        )

        rows = _exec(
            f"SELECT ai_query('databricks-meta-llama-3-3-70b-instruct', '{prompt.replace(chr(39), chr(39)+chr(39))}') AS result",
            max_rows=1,
        )
        raw = rows["rows"][0]["result"] if rows["rows"] else "[]"

        try:
            actions = json.loads(raw)
            if not isinstance(actions, list):
                actions = []
        except json.JSONDecodeError:
            match = re.search(r"\[.*\]", raw, re.DOTALL)
            if match:
                try:
                    actions = json.loads(match.group())
                except json.JSONDecodeError:
                    actions = []
            else:
                actions = []

        return {"cluster_id": req.cluster_id, "actions": actions}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Actions generation failed")
        raise HTTPException(500, f"Actions generation failed: {e}")


# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------

from fastapi.responses import FileResponse

_static_dir = "static"
_index_html = os.path.join(_static_dir, "index.html")

if os.path.isdir(_static_dir):
    # Serve static assets (js, css, etc.) at /assets/*
    app.mount("/assets", StaticFiles(directory=os.path.join(_static_dir, "assets")), name="assets")

    # SPA catch-all: any non-API route returns index.html so React Router handles it
    @app.get("/{path:path}")
    async def spa_catch_all(path: str):
        # If a real static file exists, serve it
        file_path = os.path.join(_static_dir, path)
        if path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise serve index.html for React Router
        return FileResponse(_index_html)
