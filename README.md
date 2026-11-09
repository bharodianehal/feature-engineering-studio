# Feature Engineering Studio (Customer Intelligence Studio)

A Databricks App (FastAPI + React/TypeScript/Vite/Tailwind) for governed, AI-assisted feature engineering and
customer segmentation on Unity Catalog tables. Analysts explore tables, get AI-suggested features, submit them
through a maker/approver workflow, materialize approved features to Delta, and build and refine segments
interactively. All demo data is **synthetic**.

> See [DISCLAIMER.md](DISCLAIMER.md). This is a demonstration project, not a supported product.

## Capabilities

- **Projects**: group work by project (`/api/projects`).
- **Explore**: browse catalogs, schemas and tables, preview them, and profile them with EDA: distributions and
  correlations (`/api/catalogs`, `/api/table-*`, `/api/eda/*`).
- **AI feature suggestions**: column-aware feature ideas generated with `ai_query` on a Foundation Model API
  endpoint (default `databricks-meta-llama-3-3-70b-instruct`) (`/api/feature/suggest*`).
- **Feature inventory and approvals**: submit, approve or reject features, then materialize them to Delta with an
  audit log (`/api/inventory/*`).
- **Segment studio**: K-Means / DBSCAN clustering with UMAP projection, KPI lens, personas, strategies, compare,
  split and merge, KPI lift, and next-best actions (`/api/segment/*`).

App metadata (projects, inventory, logs) is stored in `<APP_CATALOG>.fe_studio_app`. It is created at startup or
via `POST /api/setup`.

## Prerequisites

- Databricks workspace with Unity Catalog, a SQL warehouse, Databricks Apps and Foundation Model APIs (`ai_query`).
- A catalog where the app's service principal may create the `fe_studio_app` schema.

## Configure and deploy

1. Edit `app.yaml`: set `DATABRICKS_WAREHOUSE_ID` (in both `env` and `resources`) and `APP_CATALOG`.
2. Build the frontend: `cd frontend && npm install && npm run build`.
3. Deploy:
   ```bash
   databricks apps create feature-engineering-studio --profile <profile>
   databricks sync . /Workspace/Users/<you>/feature-engineering-studio --profile <profile>
   databricks apps deploy feature-engineering-studio --source-code-path /Workspace/Users/<you>/feature-engineering-studio --profile <profile>
   ```
4. Grant the app's service principal access to the source tables it should explore, and permission to query the
   model serving endpoint.

## Disclaimer

Educational/demo use only, synthetic data, AI output must be reviewed, no warranty. See [DISCLAIMER.md](DISCLAIMER.md).
