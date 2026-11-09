async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const text = await res.text();
    let msg = `API ${res.status}: ${text}`;
    if (res.status === 403) msg = `Permission denied — the app service principal needs additional access. ${text}`;
    else if (res.status === 404 && text.includes("TABLE_OR_VIEW")) msg = `Table not found — it may not exist yet or the app lacks access. ${text}`;
    else if (res.status === 503) msg = `SQL warehouse unavailable — it may be stopped. ${text}`;
    throw new Error(msg);
  }
  return res.json();
}

// Health check
export const healthCheck = () => request<{
  status: string;
  checks: Record<string, string>;
  errors: string[];
}>("/api/health");

// Setup
export const setupApp = () => request<{ status: string }>("/api/setup", { method: "POST", body: "{}" });

// Projects
export const getProjects = () => request<Project[]>("/api/projects");
export const getProject = (id: string) => request<ProjectDetail>("/api/projects/" + id);
export const createProject = (p: CreateProjectRequest) =>
  request<{ project_id: string; name: string }>("/api/projects", { method: "POST", body: JSON.stringify(p) });
export const archiveProject = (id: string) =>
  request<{ status: string }>("/api/projects/" + id, { method: "DELETE" });

// Catalog
export const getCatalogs = () => request<string[]>("/api/catalogs");
export const getSchemas = (c: string) => request<string[]>(`/api/schemas/${c}`);
export const getTables = (c: string, s: string) => request<{ name: string; type: string }[]>(`/api/tables/${c}/${s}`);
export const getTableInfo = (c: string, s: string, t: string) => request<TableInfo>(`/api/table-info/${c}/${s}/${t}`);
export const getTablePreview = (c: string, s: string, t: string) =>
  request<{ columns: string[]; rows: Record<string, string>[] }>(`/api/table-preview/${c}/${s}/${t}`);

// Column values (for one-hot encoding)
export const getColumnValues = (c: string, s: string, t: string, col: string) =>
  request<ColumnValuesResult>(`/api/column-values/${c}/${s}/${t}/${col}`);

// EDA
export const getProfile = (catalog: string, schema_name: string, table: string) =>
  request<ProfileResult>("/api/eda/profile", { method: "POST", body: JSON.stringify({ catalog, schema_name, table }) });
export const getDistribution = (catalog: string, schema_name: string, table: string, column: string, bins = 20) =>
  request<DistributionResult>("/api/eda/distribution", { method: "POST", body: JSON.stringify({ catalog, schema_name, table, column, bins }) });
export const getCorrelations = (catalog: string, schema_name: string, table: string, columns: string[]) =>
  request<CorrelationResult>("/api/eda/correlations", { method: "POST", body: JSON.stringify({ catalog, schema_name, table, columns }) });

// Feature
export const previewFeatures = (catalog: string, schema_name: string, table: string, rules: FeatureRule[]) =>
  request<{ columns: string[]; rows: Record<string, string>[] }>("/api/feature/preview", { method: "POST", body: JSON.stringify({ catalog, schema_name, table, rules }) });

// Suggestions
export const suggestRules = (catalog: string, schema_name: string, table: string) =>
  request<SuggestResult>("/api/feature/suggest", { method: "POST", body: JSON.stringify({ catalog, schema_name, table }) });
export const suggestColumn = (catalog: string, schema_name: string, table: string, column: string, existing_transforms: string[] = []) =>
  request<ColumnSuggestResult>("/api/feature/suggest-column", { method: "POST", body: JSON.stringify({ catalog, schema_name, table, column, existing_transforms }) });

// Inventory
export const getInventory = (project_id?: string) =>
  request<InventoryItem[]>(`/api/inventory${project_id ? `?project_id=${project_id}` : ""}`);
export const submitFeatures = (p: SubmitRequest) =>
  request<{ status: string; featureIds: string[] }>("/api/inventory/submit", { method: "POST", body: JSON.stringify(p) });
export const approveFeature = (feature_id: string, notes = "") =>
  request<{ status: string }>("/api/inventory/approve", { method: "POST", body: JSON.stringify({ feature_id, notes }) });
export const rejectFeature = (feature_id: string, notes = "") =>
  request<{ status: string }>("/api/inventory/reject", { method: "POST", body: JSON.stringify({ feature_id, notes }) });
export const materializeFeatures = (output_catalog: string, output_schema: string, output_table: string) =>
  request<{ status: string; table: string; rowCount: number }>("/api/inventory/materialize", { method: "POST", body: JSON.stringify({ output_catalog, output_schema, output_table }) });
export const getInventoryLogs = (feature_id?: string) =>
  request<LogEntry[]>(`/api/inventory/logs${feature_id ? `?feature_id=${feature_id}` : ""}`);

// Feature detail
export const getFeatureDetail = (id: string) => request<FeatureDetail>("/api/features/" + id);

// Segmentation
export const runSegmentation = (p: SegmentRunRequest) =>
  request<SegmentResult>("/api/segment/run", { method: "POST", body: JSON.stringify(p) });
export const getKpiLens = (p: KpiLensRequest) =>
  request<KpiLensResult>("/api/segment/kpi-lens", { method: "POST", body: JSON.stringify(p) });
export const getPersona = (p: PersonaRequest) =>
  request<PersonaResult>("/api/segment/persona", { method: "POST", body: JSON.stringify(p) });
export const getStrategies = (p: StrategyRequest) =>
  request<StrategyResult>("/api/segment/strategies", { method: "POST", body: JSON.stringify(p) });
export const compareSegments = (p: CompareRequest) =>
  request<CompareResult>("/api/segment/compare", { method: "POST", body: JSON.stringify(p) });
export const getKpiLift = (p: KpiLiftRequest) =>
  request<KpiLiftResult>("/api/segment/kpi-lift", { method: "POST", body: JSON.stringify(p) });
export const getContext = (p: ContextRequest) =>
  request<ContextResult>("/api/segment/context", { method: "POST", body: JSON.stringify(p) });
export const getActions = (p: ActionsRequest) =>
  request<ActionsResult>("/api/segment/actions", { method: "POST", body: JSON.stringify(p) });

// ─── Types ───────────────────────────────────────────────────────────────

export interface SourceTableRef {
  catalog: string; schema_name: string; table: string;
}

export interface Project {
  project_id: string; name: string; description: string;
  catalog: string; schema_name: string; source_table: string;
  output_catalog: string; output_schema: string; output_table: string;
  status: string; created_by: string; created_at: string; updated_at: string;
  feature_count: number; approved_count: number; materialized_count: number;
  tables: SourceTableRef[];
}

export interface ProjectDetail extends Project {
  features: InventoryItem[];
}

export interface CreateProjectRequest {
  name: string; description?: string;
  catalog: string;
  tables: SourceTableRef[];
  output_table?: string;
}

export interface TableInfo { columns: { name: string; type: string; comment: string }[]; rowCount: number }

export interface ProfileColumn {
  name: string; type: string; isNumeric: boolean;
  nullCount: number; nullPct: number; distinctCount: number; distinctPct: number;
  min?: number | null; max?: number | null; mean?: number | null; std?: number | null;
  median?: number | null; q1?: number | null; q3?: number | null;
  skewness?: number | null; kurtosis?: number | null;
  topValues?: { value: string; count: number; pct: number }[];
}
export interface ProfileResult {
  rowCount: number; colCount: number; numericCount: number; categoricalCount: number;
  totalMissing: number; totalMissingPct: number;
  columns: ProfileColumn[]; alerts: { type: string; column: string; message: string }[];
}
export interface DistributionResult { type: "numeric" | "categorical"; bins: { label: string; count: number }[] }
export interface CorrelationResult {
  columns: string[]; matrix: number[][]; vif: { column: string; vif: number | null }[];
  highCorrelations: { col_a: string; col_b: string; value: number }[];
}
export interface ColumnValuesResult {
  column: string; totalDistinct: number; totalRows: number;
  values: { value: string; count: number; pct: number }[];
}
export interface FeatureRule { id: string; type: string; params: Record<string, unknown>; outputColumn: string; name: string; notes?: string }
export interface SubmitRequest {
  project_id?: string;
  source_catalog: string; source_schema: string; source_table: string;
  output_catalog: string; output_schema: string; output_table: string;
  rules: FeatureRule[]; notes?: string;
}
export interface InventoryItem {
  feature_id: string; project_id: string;
  source_catalog: string; source_schema: string; source_table: string;
  rule_type: string; rule_params: string; output_column: string;
  output_catalog: string; output_schema: string; output_table: string;
  created_by: string; created_at: string; updated_at: string; status: string;
  approved_by: string | null; approved_at: string | null; notes: string;
}
export interface LogEntry { log_id: string; feature_id: string; action: string; actor: string; action_time: string; details: string }
export interface SuggestedRule {
  type: string; params: Record<string, unknown>; outputColumn: string; name: string; reason: string;
}
export interface SuggestResult {
  suggestions: SuggestedRule[];
  tableProfile: { numericCount: number; categoricalCount: number; rowCount: number };
}
export interface ColumnSuggestResult {
  suggestions: SuggestedRule[];
  source: "ai" | "heuristic";
}
export interface FeatureDetail extends InventoryItem {
  logs: LogEntry[];
  project?: Project;
  sql_expression: string;
}

// Variable categories
export type VarCategory = "transform" | "binning" | "encoding" | "imputation" | "derived";

export const VAR_CATEGORY_LABELS: Record<VarCategory, string> = {
  transform: "Transforms", binning: "Binning", encoding: "Encoding",
  imputation: "Imputation", derived: "Derived",
};

export const RULE_CATEGORY: Record<string, VarCategory> = {
  log: "transform", log10: "transform", sqrt: "transform", square: "transform",
  inverse: "transform", inverse_square: "transform", inverse_sqrt: "transform",
  centering: "transform", zscore: "transform", minmax: "transform", range_std: "transform",
  bin_quantile: "binning", bin_custom: "binning", bucket_bin: "binning",
  one_hot: "encoding", label_encode: "encoding",
  fillna: "imputation", impute_mean: "imputation", impute_median: "imputation",
  impute_mode: "imputation", impute_constant: "imputation", missing_indicator: "imputation",
  ratio: "derived", difference: "derived", product: "derived", months_between: "derived",
};

export const TRANSFORM_PREFIX: Record<string, string> = {
  log: "LOG_", log10: "LOG10_", sqrt: "SQRT_", square: "SQR_",
  inverse: "INV_", inverse_square: "INVSQR_", inverse_sqrt: "INVSQRT_",
  centering: "CTR_", zscore: "STD_", minmax: "SCALED_", range_std: "RNG_",
  bin_quantile: "BIN_", bin_custom: "BIN_", bucket_bin: "BKT_",
  one_hot: "OH_", label_encode: "LBL_",
  fillna: "IMP_", impute_mean: "IMP_", impute_median: "IMP_",
  impute_mode: "IMP_", impute_constant: "IMP_", missing_indicator: "M_",
  ratio: "R_", difference: "DIFF_", product: "PROD_", months_between: "MTHS_",
};

// ─── Segmentation Types ──────────────────────────────────────────────────

export interface SegmentRunRequest {
  catalog: string;
  schema_name: string;
  table: string;
  algorithm: "kmeans" | "dbscan";
  k?: number;
  eps?: number;
  min_samples?: number;
  features?: string[];
}

export interface SegmentPoint {
  x: number;
  y: number;
  cluster: number;
  index: number;
}

export interface ClusterSummary {
  cluster_id: number;
  size: number;
  percentage: number;
  feature_means: Record<string, number>;
  top_features: string[];
}

export interface SegmentResult {
  points: SegmentPoint[];
  clusters: ClusterSummary[];
  silhouette_score: number;
  n_clusters: number;
  feature_names: string[];
}

export interface KpiLensRequest {
  catalog: string;
  schema_name: string;
  table: string;
  kpi_column: string;
  cluster_assignments: number[];
}

export interface KpiLensResult {
  values: number[];
  kpi_column: string;
  cluster_means: Record<number, number>;
}

export interface PersonaRequest {
  cluster_id: number;
  feature_means: Record<string, number>;
  size: number;
  percentage: number;
  table_name: string;
}

export interface PersonaResult {
  persona: string;
  cluster_id: number;
}

export interface StrategyRequest {
  cluster_id: number;
  feature_means: Record<string, number>;
  size: number;
  percentage: number;
  table_name: string;
}

export interface StrategyCard {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export interface StrategyResult {
  strategies: StrategyCard[];
  cluster_id: number;
}

export interface CompareRequest {
  cluster_a: number;
  cluster_b: number;
  clusters: ClusterSummary[];
  table_name: string;
}

export interface CompareResult {
  summary: string;
  differences: { feature: string; cluster_a_value: number; cluster_b_value: number; delta: number }[];
  cluster_a: number;
  cluster_b: number;
}

// ─── NeuralLift Types ───────────────────────────────────────────────────

export interface KpiLiftRequest {
  catalog: string; schema_name: string; table: string;
  kpi_column: string; cluster_assignments: number[];
}
export interface ClusterLift {
  cluster_id: number; cluster_mean: number; lift_pct: number;
  size: number; size_pct: number; opportunity_score: number; direction: string;
}
export interface KpiLiftResult {
  kpi_column: string; global_mean: number; cluster_lifts: ClusterLift[];
}
export interface ContextRequest {
  cluster_id: number; feature_means: Record<string, number>;
  all_clusters: ClusterSummary[]; table_name?: string;
}
export interface DefiningFeature {
  feature: string; in_segment: number; out_segment: number;
  index: number; importance: string;
}
export interface ContextResult {
  cluster_id: number; context_summary: string;
  defining_features: DefiningFeature[]; segment_label: string;
}
export interface ActionsRequest {
  cluster_id: number; feature_means: Record<string, number>;
  kpi_lifts?: Record<string, number>; context_summary?: string; table_name?: string;
}
export interface ActionItem {
  title: string; description: string; target_kpi: string;
  expected_lift: string; priority: string; effort: string;
}
export interface ActionsResult {
  cluster_id: number; actions: ActionItem[];
}
