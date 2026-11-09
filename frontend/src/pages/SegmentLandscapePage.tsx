import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  getCatalogs, getSchemas, getTables, getTableInfo,
  runSegmentation, getKpiLens, getPersona, getStrategies, compareSegments,
  getKpiLift, getContext, getActions,
} from "../api";
import type {
  SegmentResult, ClusterSummary, KpiLensResult, TableInfo,
  PersonaResult, StrategyResult, CompareResult,
  KpiLiftResult, ContextResult, ActionsResult,
} from "../api";
import Plot from "react-plotly.js";
import {
  Brain, Loader2, Database, ChevronDown, Play,
  Users, Target, BarChart3, Sparkles, ArrowRight,
  Settings2, Check, RotateCcw, Columns3,
  TrendingUp, TrendingDown, User, Zap, Layers,
  Lightbulb, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import CoPilotPanel from "./CoPilotPanel";

const CLUSTER_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#3b82f6", "#84cc16",
];

const NUMERIC_TYPES = ["int", "long", "short", "float", "double", "decimal", "bigint", "smallint", "tinyint"];

type Algorithm = "kmeans" | "dbscan";
type TabId = "context" | "kpi-lift" | "persona" | "actions" | "compare";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "context", label: "Context", icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { id: "kpi-lift", label: "KPI Lift", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: "persona", label: "Persona", icon: <User className="w-3.5 h-3.5" /> },
  { id: "actions", label: "Actions", icon: <Zap className="w-3.5 h-3.5" /> },
  { id: "compare", label: "Compare", icon: <Layers className="w-3.5 h-3.5" /> },
];

export default function SegmentLandscapePage() {
  // Table selection
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<{ name: string; type: string }[]>([]);
  const [cat, setCat] = useState("");
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [loadState, setLoadState] = useState("");

  // Column info
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Algorithm controls
  const [algorithm, setAlgorithm] = useState<Algorithm>("kmeans");
  const [k, setK] = useState(5);
  const [eps, setEps] = useState(0.5);
  const [minSamples, setMinSamples] = useState(5);

  // Feature selection
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(true);

  // Results
  const [result, setResult] = useState<SegmentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  // Selection & detail
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("context");

  // KPI Lens (scatter overlay)
  const [kpiColumn, setKpiColumn] = useState("");
  const [kpiResult, setKpiResult] = useState<KpiLensResult | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);

  // Context cache
  const [contextCache, setContextCache] = useState<Record<number, ContextResult>>({});
  const [contextLoading, setContextLoading] = useState(false);

  // KPI Lift
  const [liftKpiColumn, setLiftKpiColumn] = useState("");
  const [kpiLiftResult, setKpiLiftResult] = useState<KpiLiftResult | null>(null);
  const [kpiLiftLoading, setKpiLiftLoading] = useState(false);

  // Persona & Strategy
  const [persona, setPersona] = useState<PersonaResult | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [actionsResult, setActionsResult] = useState<ActionsResult | null>(null);
  const [actionsLoading, setActionsLoading] = useState(false);

  // Legacy strategy (kept for compare tab internal use)
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  // Compare
  const [compareWith, setCompareWith] = useState<number | "">("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Track which persona/actions cluster we last auto-loaded for
  const lastPersonaCluster = useRef<number | null>(null);
  const lastActionsCluster = useRef<number | null>(null);

  // Load catalogs
  useEffect(() => {
    setLoadState("c");
    getCatalogs().then(setCatalogs).finally(() => setLoadState(""));
  }, []);

  useEffect(() => {
    if (!cat) { setSchemas([]); setSchema(""); setTables([]); setTable(""); return; }
    setSchemas([]); setSchema(""); setTables([]); setTable("");
    setLoadState("s");
    getSchemas(cat).then(setSchemas).finally(() => setLoadState(""));
  }, [cat]);

  useEffect(() => {
    if (!cat || !schema) { setTables([]); setTable(""); return; }
    setTables([]); setTable("");
    setLoadState("t");
    getTables(cat, schema).then(setTables).finally(() => setLoadState(""));
  }, [cat, schema]);

  // Load column info when table changes
  useEffect(() => {
    if (!cat || !schema || !table) { setTableInfo(null); setSelectedFeatures([]); return; }
    setInfoLoading(true);
    setTableInfo(null);
    getTableInfo(cat, schema, table).then(info => {
      setTableInfo(info);
      const numCols = info.columns
        .filter(c => NUMERIC_TYPES.some(t => c.type.toLowerCase().includes(t)))
        .map(c => c.name);
      setSelectedFeatures(numCols);
    }).finally(() => setInfoLoading(false));
  }, [cat, schema, table]);

  const numericColumns = useMemo(() => {
    if (!tableInfo) return [];
    return tableInfo.columns.filter(c => NUMERIC_TYPES.some(t => c.type.toLowerCase().includes(t)));
  }, [tableInfo]);

  const toggleFeature = (col: string) => {
    setSelectedFeatures(prev =>
      prev.includes(col) ? prev.filter(f => f !== col) : [...prev, col]
    );
  };

  const selectAllFeatures = () => setSelectedFeatures(numericColumns.map(c => c.name));
  const clearAllFeatures = () => setSelectedFeatures([]);

  const tableLabel = cat && schema && table ? `${cat}.${schema}.${table}` : "";

  const handleRun = async () => {
    if (!cat || !schema || !table) return;
    setRunning(true);
    setError("");
    setResult(null);
    setSelectedCluster(null);
    setKpiResult(null);
    setKpiColumn("");
    setPersona(null);
    setActionsResult(null);
    setStrategyResult(null);
    setCompareResult(null);
    setContextCache({});
    setKpiLiftResult(null);
    setLiftKpiColumn("");
    lastPersonaCluster.current = null;
    lastActionsCluster.current = null;
    try {
      const r = await runSegmentation({
        catalog: cat,
        schema_name: schema,
        table,
        algorithm,
        k: algorithm === "kmeans" ? k : undefined,
        eps: algorithm === "dbscan" ? eps : undefined,
        min_samples: algorithm === "dbscan" ? minSamples : undefined,
        features: selectedFeatures.length > 0 ? selectedFeatures : undefined,
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Segmentation failed");
    } finally {
      setRunning(false);
    }
  };

  const handleKpiLens = async (col: string) => {
    setKpiColumn(col);
    if (!col || !result) { setKpiResult(null); return; }
    setKpiLoading(true);
    try {
      const r = await getKpiLens({
        catalog: cat,
        schema_name: schema,
        table,
        kpi_column: col,
        cluster_assignments: result.points.map(p => p.cluster),
      });
      setKpiResult(r);
    } catch { setKpiResult(null); }
    finally { setKpiLoading(false); }
  };

  // Auto-load context when cluster is selected
  const loadContext = useCallback(async (clusterId: number) => {
    if (!result) return;
    if (contextCache[clusterId]) return; // already cached
    const clusterData = result.clusters.find(c => c.cluster_id === clusterId);
    if (!clusterData) return;
    setContextLoading(true);
    try {
      const r = await getContext({
        cluster_id: clusterId,
        feature_means: clusterData.feature_means,
        all_clusters: result.clusters,
        table_name: tableLabel,
      });
      setContextCache(prev => ({ ...prev, [clusterId]: r }));
    } catch { /* ignore */ }
    finally { setContextLoading(false); }
  }, [result, contextCache, tableLabel]);

  // When cluster is selected, auto-load context
  useEffect(() => {
    if (selectedCluster !== null && result) {
      loadContext(selectedCluster);
    }
  }, [selectedCluster, result, loadContext]);

  const handleSelectCluster = (clusterId: number) => {
    setSelectedCluster(clusterId);
    setActiveTab("context");
    setCompareResult(null);
    setCompareWith("");
  };

  const handleKpiLift = async (col: string) => {
    setLiftKpiColumn(col);
    if (!col || !result) { setKpiLiftResult(null); return; }
    setKpiLiftLoading(true);
    try {
      const r = await getKpiLift({
        catalog: cat,
        schema_name: schema,
        table,
        kpi_column: col,
        cluster_assignments: result.points.map(p => p.cluster),
      });
      setKpiLiftResult(r);
    } catch { setKpiLiftResult(null); }
    finally { setKpiLiftLoading(false); }
  };

  const handlePersona = useCallback(async (cluster: ClusterSummary) => {
    if (lastPersonaCluster.current === cluster.cluster_id && persona) return;
    setPersonaLoading(true);
    lastPersonaCluster.current = cluster.cluster_id;
    try {
      const r = await getPersona({
        cluster_id: cluster.cluster_id,
        feature_means: cluster.feature_means,
        size: cluster.size,
        percentage: cluster.percentage,
        table_name: tableLabel,
      });
      setPersona(r);
    } catch { /* ignore */ }
    finally { setPersonaLoading(false); }
  }, [tableLabel, persona]);

  const handleActions = useCallback(async (cluster: ClusterSummary) => {
    if (lastActionsCluster.current === cluster.cluster_id && actionsResult) return;
    setActionsLoading(true);
    lastActionsCluster.current = cluster.cluster_id;
    try {
      const contextData = contextCache[cluster.cluster_id];
      const r = await getActions({
        cluster_id: cluster.cluster_id,
        feature_means: cluster.feature_means,
        context_summary: contextData?.context_summary,
        table_name: tableLabel,
      });
      setActionsResult(r);
    } catch { /* ignore */ }
    finally { setActionsLoading(false); }
  }, [tableLabel, actionsResult, contextCache]);

  const handleCompare = async (clusterA: number, clusterB: number) => {
    if (!result) return;
    setCompareLoading(true);
    try {
      const r = await compareSegments({
        cluster_a: clusterA,
        cluster_b: clusterB,
        clusters: result.clusters,
        table_name: tableLabel,
      });
      setCompareResult(r);
    } catch { /* ignore */ }
    finally { setCompareLoading(false); }
  };

  // Auto-load persona when persona tab is opened
  useEffect(() => {
    if (activeTab === "persona" && selectedCluster !== null && result) {
      const cluster = result.clusters.find(c => c.cluster_id === selectedCluster);
      if (cluster) handlePersona(cluster);
    }
  }, [activeTab, selectedCluster, result, handlePersona]);

  // Auto-load actions when actions tab is opened
  useEffect(() => {
    if (activeTab === "actions" && selectedCluster !== null && result) {
      const cluster = result.clusters.find(c => c.cluster_id === selectedCluster);
      if (cluster) handleActions(cluster);
    }
  }, [activeTab, selectedCluster, result, handleActions]);

  const selectedClusterData = useMemo(() => {
    if (selectedCluster === null || !result) return null;
    return result.clusters.find(c => c.cluster_id === selectedCluster) || null;
  }, [selectedCluster, result]);

  // Build plotly data
  const plotData = useMemo(() => {
    if (!result) return [];

    // If KPI lens is active, single trace with colorscale
    if (kpiResult && kpiResult.values.length === result.points.length) {
      return [{
        x: result.points.map(p => p.x),
        y: result.points.map(p => p.y),
        mode: "markers" as const,
        type: "scattergl" as const,
        marker: {
          size: 4,
          color: kpiResult.values,
          colorscale: "RdYlGn" as const,
          showscale: true,
          colorbar: { title: kpiResult.kpi_column, thickness: 15 },
          opacity: 0.7,
        },
        hovertemplate: `${kpiResult.kpi_column}: %{marker.color:.2f}<extra></extra>`,
      }];
    }

    // Cluster-colored traces
    const clusters = Array.from(new Set(result.points.map(p => p.cluster))).sort((a, b) => a - b);
    return clusters.map(cid => {
      const pts = result.points.filter(p => p.cluster === cid);
      const isSelected = selectedCluster === cid;
      return {
        x: pts.map(p => p.x),
        y: pts.map(p => p.y),
        mode: "markers" as const,
        type: "scattergl" as const,
        name: `Cluster ${cid}`,
        marker: {
          size: isSelected ? 6 : 4,
          color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
          opacity: selectedCluster !== null && !isSelected ? 0.2 : 0.7,
        },
        hovertemplate: `Cluster ${cid}<br>(%{x:.2f}, %{y:.2f})<extra></extra>`,
      };
    });
  }, [result, kpiResult, selectedCluster]);

  // Helper to get segment label from cache
  const getSegmentLabel = (clusterId: number): string | null => {
    return contextCache[clusterId]?.segment_label || null;
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-navy-900">Customer Segments</h1>
            {tableLabel && (
              <p className="text-[14px] text-navy-500 font-mono">{tableLabel}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <>
              <span className="px-3 py-1 text-[12px] font-semibold rounded-full bg-brand-100 text-brand-700">
                {result.n_clusters} clusters
              </span>
              <span className="px-3 py-1 text-[12px] font-semibold rounded-full bg-emerald-50 text-emerald-700">
                Silhouette: {result.silhouette_score.toFixed(3)}
              </span>
              <span className="px-3 py-1 text-[12px] font-semibold rounded-full bg-navy-100 text-navy-600">
                {result.points.length.toLocaleString()} pts
              </span>
            </>
          )}
          <button onClick={() => setShowConfig(!showConfig)}
            className={`p-2 rounded-xl border transition-all duration-200 ${showConfig ? "bg-brand-50 border-brand-200 text-brand-600" : "border-navy-200 text-navy-500 hover:bg-navy-50"}`}>
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {showConfig && (
        <div className="bg-white rounded-2xl border border-navy-200 shadow-card p-6 mb-5 space-y-5">
          {/* Row 1: Table selection */}
          <div>
            <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" />Source Table
            </div>
            <div className="flex items-center gap-3">
              <select value={cat} onChange={e => setCat(e.target.value)}
                className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 min-w-[160px]">
                <option value="">{loadState === "c" ? "Loading..." : "Select catalog..."}</option>
                {catalogs.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={schema} onChange={e => setSchema(e.target.value)} disabled={!cat}
                className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 min-w-[160px] disabled:opacity-40">
                <option value="">{loadState === "s" ? "Loading..." : "Select schema..."}</option>
                {schemas.map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={table} onChange={e => setTable(e.target.value)} disabled={!schema}
                className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 min-w-[200px] disabled:opacity-40">
                <option value="">{loadState === "t" ? "Loading..." : "Select table..."}</option>
                {tables.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              {tableInfo && (
                <span className="text-[13px] text-navy-400 shrink-0">{tableInfo.rowCount.toLocaleString()} rows</span>
              )}
            </div>
          </div>

          {/* Row 2: Feature selection */}
          {table && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest flex items-center gap-1.5">
                  <Columns3 className="w-3.5 h-3.5" />Features ({selectedFeatures.length} of {numericColumns.length} numeric columns)
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllFeatures}
                    className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold">Select All</button>
                  <span className="text-navy-300">|</span>
                  <button onClick={clearAllFeatures}
                    className="text-[11px] text-navy-400 hover:text-navy-600 font-semibold">Clear</button>
                </div>
              </div>
              {infoLoading ? (
                <div className="flex items-center gap-2 text-[14px] text-navy-400 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading columns...
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {numericColumns.map(col => {
                    const selected = selectedFeatures.includes(col.name);
                    return (
                      <button key={col.name} onClick={() => toggleFeature(col.name)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-xl border transition-all duration-200 ${
                          selected
                            ? "bg-brand-50 border-brand-300 text-brand-700 font-semibold"
                            : "bg-white border-navy-200 text-navy-500 hover:border-navy-300"
                        }`}>
                        {selected && <Check className="w-3 h-3" />}
                        {col.name}
                        <span className="text-[11px] text-navy-400 ml-0.5">{col.type}</span>
                      </button>
                    );
                  })}
                  {numericColumns.length === 0 && tableInfo && (
                    <div className="text-[14px] text-navy-400 py-1">No numeric columns found in this table</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Row 3: Algorithm + parameters + Run */}
          {table && selectedFeatures.length > 0 && (
            <div className="flex items-end gap-4 pt-2 border-t border-navy-200">
              <div>
                <label className="text-[12px] font-semibold text-navy-500 block mb-1.5">Algorithm</label>
                <select value={algorithm} onChange={e => setAlgorithm(e.target.value as Algorithm)}
                  className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300">
                  <option value="kmeans">K-Means</option>
                  <option value="dbscan">DBSCAN</option>
                </select>
              </div>

              {algorithm === "kmeans" ? (
                <div className="flex-1 max-w-[280px]">
                  <label className="text-[12px] font-semibold text-navy-500 block mb-1.5">
                    Number of Clusters (K): <span className="text-brand-600 font-bold">{k}</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-navy-400">2</span>
                    <input type="range" min={2} max={20} value={k} onChange={e => setK(Number(e.target.value))}
                      className="flex-1 accent-brand-500 h-2" />
                    <span className="text-[12px] text-navy-400">20</span>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[12px] font-semibold text-navy-500 block mb-1.5">Epsilon (eps)</label>
                    <input type="number" step={0.1} min={0.1} value={eps} onChange={e => setEps(Number(e.target.value))}
                      className="w-24 px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300" />
                  </div>
                  <div>
                    <label className="text-[12px] font-semibold text-navy-500 block mb-1.5">Min Samples</label>
                    <input type="number" min={1} value={minSamples} onChange={e => setMinSamples(Number(e.target.value))}
                      className="w-24 px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300" />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 ml-auto">
                {result && (
                  <button onClick={() => { setResult(null); setSelectedCluster(null); }}
                    className="flex items-center gap-1.5 px-5 py-2.5 text-[14px] font-semibold text-navy-600 border border-navy-200 rounded-xl hover:bg-navy-50 transition-all duration-200">
                    <RotateCcw className="w-3.5 h-3.5" />Reset
                  </button>
                )}
                <button onClick={handleRun}
                  disabled={running || selectedFeatures.length < 2}
                  className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold text-white bg-brand-500 rounded-xl shadow-sm hover:bg-brand-600 disabled:opacity-40 transition-all duration-200">
                  {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {result ? "Re-run" : "Run Segmentation"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-[14px] text-red-700 mb-5">
          {error}
        </div>
      )}

      {/* Loading state */}
      {running && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-3" />
            <div className="text-[14px] text-navy-600">Running {algorithm} clustering...</div>
            <div className="text-[13px] text-navy-400 mt-1">This may take a moment for large datasets</div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!running && !result && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Brain className="w-12 h-12 text-navy-300 mx-auto mb-3" />
            <div className="text-[16px] font-semibold text-navy-700 mb-1">
              {table ? "Ready to segment" : "Select a table to begin"}
            </div>
            <div className="text-[14px] text-navy-500">
              {table
                ? "Choose an algorithm and click Run to discover customer segments"
                : "Pick a catalog, schema, and table from the dropdowns above"}
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      {!running && result && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {/* Scatter plot — full width */}
          <div className="bg-white rounded-2xl border border-navy-200 shadow-card p-5 flex flex-col" style={{ minHeight: 380 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-semibold text-navy-700">UMAP Projection</span>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-navy-500">KPI Lens:</span>
                <select value={kpiColumn}
                  onChange={e => handleKpiLens(e.target.value)}
                  className="px-4 py-2.5 text-[13px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300">
                  <option value="">None</option>
                  {result.feature_names.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                {kpiLoading && <Loader2 className="w-3 h-3 animate-spin text-brand-500" />}
              </div>
            </div>
            <div style={{ height: 320 }}>
              <Plot
                data={plotData}
                layout={{
                  autosize: true,
                  margin: { l: 40, r: 20, t: 10, b: 40 },
                  xaxis: { title: { text: "UMAP 1" }, gridcolor: "#e8ecf4", zerolinecolor: "#e8ecf4" },
                  yaxis: { title: { text: "UMAP 2" }, gridcolor: "#e8ecf4", zerolinecolor: "#e8ecf4" },
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "transparent",
                  showlegend: !kpiResult,
                  legend: { orientation: "h", y: -0.15 },
                  dragmode: "lasso",
                }}
                config={{ responsive: true, displayModeBar: true, modeBarButtonsToRemove: ["toImage"] }}
                style={{ width: "100%", height: "100%" }}
                useResizeHandler
                onClick={(e) => {
                  if (e.points && e.points.length > 0) {
                    const pt = e.points[0];
                    const curveIdx = pt.curveNumber;
                    if (!kpiResult) {
                      const clusters = Array.from(new Set(result.points.map(p => p.cluster))).sort((a, b) => a - b);
                      if (curveIdx < clusters.length) {
                        handleSelectCluster(clusters[curveIdx]);
                      }
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* Segment overview cards — horizontal scroll */}
          <div className="mt-5 overflow-x-auto pb-2">
            <div className="flex gap-4" style={{ minWidth: "max-content" }}>
              {result.clusters.map(c => {
                const isActive = selectedCluster === c.cluster_id;
                const label = getSegmentLabel(c.cluster_id);
                const liftData = kpiLiftResult?.cluster_lifts.find(l => l.cluster_id === c.cluster_id);
                return (
                  <button key={c.cluster_id}
                    onClick={() => handleSelectCluster(c.cluster_id)}
                    className={`shrink-0 bg-white rounded-2xl border px-5 py-3 text-left transition-all duration-200 min-w-[200px] ${
                      isActive
                        ? "border-brand-300 ring-2 ring-brand-100 shadow-card"
                        : "border-navy-200 shadow-card hover:border-navy-200 hover:shadow-card-hover"
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: CLUSTER_COLORS[c.cluster_id % CLUSTER_COLORS.length] }} />
                      <span className="text-[15px] font-bold text-navy-800">Cluster {c.cluster_id}</span>
                    </div>
                    {label && (
                      <div className="text-[13px] font-semibold text-brand-600 mb-1 truncate">{label}</div>
                    )}
                    <div className="text-lg font-bold text-navy-900">
                      {c.size.toLocaleString()}
                      <span className="text-[14px] font-normal text-navy-500 ml-1">
                        ({c.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    {c.top_features && c.top_features.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.top_features.slice(0, 3).map(f => (
                          <span key={f} className="text-[11px] px-1.5 py-0.5 rounded bg-navy-50 text-navy-600 font-mono">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {liftData && (
                      <div className={`mt-1.5 flex items-center gap-1 text-[12px] font-semibold ${
                        liftData.lift_pct >= 0 ? "text-emerald-600" : "text-red-500"
                      }`}>
                        {liftData.lift_pct >= 0
                          ? <ArrowUpRight className="w-3 h-3" />
                          : <ArrowDownRight className="w-3 h-3" />}
                        {liftData.lift_pct >= 0 ? "+" : ""}{liftData.lift_pct.toFixed(1)}% {kpiLiftResult?.kpi_column}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab bar + tab content */}
          {selectedCluster !== null && selectedClusterData && (
            <div className="mt-5">
              {/* Tab bar */}
              <div className="bg-white rounded-xl shadow-card p-1.5 inline-flex items-center gap-1 mb-5">
                {TABS.map(tab => (
                  <button key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-5 py-2.5 text-[14px] font-semibold rounded-lg transition-all duration-200 ${
                      activeTab === tab.id
                        ? "bg-navy-900 text-white shadow-sm"
                        : "text-navy-600 hover:bg-navy-50 rounded-lg"
                    }`}>
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="bg-white rounded-2xl border border-navy-200 shadow-card p-6 min-h-[280px]">
                {/* ─── Context Tab ─── */}
                {activeTab === "context" && (
                  <div>
                    {contextLoading && !contextCache[selectedCluster] ? (
                      <div className="flex items-center gap-2 text-[14px] text-navy-500 py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                        Analyzing segment context...
                      </div>
                    ) : contextCache[selectedCluster] ? (
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: CLUSTER_COLORS[selectedCluster % CLUSTER_COLORS.length] }} />
                          <h2 className="text-2xl font-bold tracking-tight text-navy-900">
                            {contextCache[selectedCluster].segment_label}
                          </h2>
                          <span className="px-2 py-0.5 text-[12px] rounded-full bg-navy-100 text-navy-600">
                            Cluster {selectedCluster}
                          </span>
                        </div>
                        <p className="text-[14px] text-navy-600 leading-relaxed mb-6">
                          {contextCache[selectedCluster].context_summary}
                        </p>

                        {/* Defining Features table */}
                        <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest mb-3">
                          Defining Features
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[14px]">
                            <thead>
                              <tr className="border-b border-navy-200">
                                <th className="text-left py-2 pr-4 text-[12px] font-semibold text-navy-500">Feature</th>
                                <th className="text-right py-2 px-3 text-[12px] font-semibold text-navy-500">In-Segment</th>
                                <th className="text-right py-2 px-3 text-[12px] font-semibold text-navy-500">Out-of-Segment</th>
                                <th className="py-2 px-3 text-[12px] font-semibold text-navy-500 text-center w-[200px]">Index</th>
                                <th className="text-center py-2 pl-3 text-[12px] font-semibold text-navy-500">Importance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {contextCache[selectedCluster].defining_features.map((df) => {
                                const indexVal = df.index;
                                const barWidth = Math.min(Math.abs(indexVal - 100), 100);
                                const isOver = indexVal >= 100;
                                return (
                                  <tr key={df.feature} className="border-b border-navy-50 hover:bg-navy-25">
                                    <td className="py-2 pr-4 text-navy-700 font-mono text-[12px]">{df.feature}</td>
                                    <td className="py-2 px-3 text-right font-mono text-navy-800">{df.in_segment.toFixed(2)}</td>
                                    <td className="py-2 px-3 text-right font-mono text-navy-500">{df.out_segment.toFixed(2)}</td>
                                    <td className="py-2 px-3">
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 h-4 relative bg-navy-50 rounded overflow-hidden">
                                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-navy-300" />
                                          {isOver ? (
                                            <div
                                              className="absolute top-0 bottom-0 left-1/2 bg-emerald-400 rounded-r"
                                              style={{ width: `${barWidth / 2}%` }}
                                            />
                                          ) : (
                                            <div
                                              className="absolute top-0 bottom-0 bg-red-400 rounded-l"
                                              style={{
                                                right: "50%",
                                                width: `${barWidth / 2}%`,
                                              }}
                                            />
                                          )}
                                        </div>
                                        <span className={`text-[12px] font-semibold w-10 text-right ${
                                          isOver ? "text-emerald-600" : "text-red-500"
                                        }`}>
                                          {indexVal.toFixed(0)}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-2 pl-3 text-center">
                                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                        df.importance === "high" ? "bg-red-50 text-red-700"
                                        : df.importance === "medium" ? "bg-amber-50 text-amber-700"
                                        : "bg-navy-100 text-navy-600"
                                      }`}>
                                        {df.importance}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[14px] text-navy-500 py-8 text-center">
                        Select a cluster to view its context analysis.
                      </div>
                    )}
                  </div>
                )}

                {/* ─── KPI Lift Tab ─── */}
                {activeTab === "kpi-lift" && (
                  <div>
                    <div className="flex items-center gap-3 mb-5">
                      <span className="text-[15px] font-semibold text-navy-700">KPI Column:</span>
                      <select
                        value={liftKpiColumn}
                        onChange={e => handleKpiLift(e.target.value)}
                        className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 min-w-[180px]">
                        <option value="">Select KPI...</option>
                        {result.feature_names.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {kpiLiftLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-500" />}
                    </div>

                    {kpiLiftResult && (
                      <div>
                        <div className="flex items-center gap-4 mb-5 text-[14px]">
                          <span className="text-navy-500">Global Mean:</span>
                          <span className="font-mono font-bold text-navy-800">{kpiLiftResult.global_mean.toFixed(2)}</span>
                        </div>

                        {/* Lift table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-[14px]">
                            <thead>
                              <tr className="border-b border-navy-200">
                                <th className="text-left py-2 pr-3 text-[12px] font-semibold text-navy-500">Cluster</th>
                                <th className="text-right py-2 px-3 text-[12px] font-semibold text-navy-500">Mean</th>
                                <th className="py-2 px-3 text-[12px] font-semibold text-navy-500 w-[260px] text-center">Lift %</th>
                                <th className="text-center py-2 px-3 text-[12px] font-semibold text-navy-500">Direction</th>
                                <th className="text-right py-2 px-3 text-[12px] font-semibold text-navy-500">Size</th>
                                <th className="text-right py-2 pl-3 text-[12px] font-semibold text-navy-500">Opportunity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...kpiLiftResult.cluster_lifts]
                                .sort((a, b) => b.lift_pct - a.lift_pct)
                                .map(cl => {
                                  const isSelected = cl.cluster_id === selectedCluster;
                                  const barW = Math.min(Math.abs(cl.lift_pct), 100);
                                  const isPos = cl.lift_pct >= 0;
                                  return (
                                    <tr key={cl.cluster_id}
                                      className={`border-b border-navy-50 ${isSelected ? "bg-brand-50" : "hover:bg-navy-25"}`}>
                                      <td className="py-2 pr-3">
                                        <div className="flex items-center gap-2">
                                          <div className="w-2.5 h-2.5 rounded-full"
                                            style={{ backgroundColor: CLUSTER_COLORS[cl.cluster_id % CLUSTER_COLORS.length] }} />
                                          <span className={`text-[14px] ${isSelected ? "font-bold text-brand-700" : "text-navy-700"}`}>
                                            Cluster {cl.cluster_id}
                                          </span>
                                          {contextCache[cl.cluster_id] && (
                                            <span className="text-[11px] text-navy-400 truncate max-w-[100px]">
                                              {contextCache[cl.cluster_id].segment_label}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-right font-mono text-navy-800">
                                        {cl.cluster_mean.toFixed(2)}
                                      </td>
                                      <td className="py-2 px-3">
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 h-4 relative bg-navy-50 rounded overflow-hidden">
                                            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-navy-300" />
                                            {isPos ? (
                                              <div
                                                className="absolute top-0 bottom-0 left-1/2 bg-emerald-400 rounded-r"
                                                style={{ width: `${barW / 2}%` }}
                                              />
                                            ) : (
                                              <div
                                                className="absolute top-0 bottom-0 bg-red-400 rounded-l"
                                                style={{ right: "50%", width: `${barW / 2}%` }}
                                              />
                                            )}
                                          </div>
                                          <span className={`text-[12px] font-bold w-14 text-right ${
                                            isPos ? "text-emerald-600" : "text-red-500"
                                          }`}>
                                            {isPos ? "+" : ""}{cl.lift_pct.toFixed(1)}%
                                          </span>
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 text-center">
                                        {isPos
                                          ? <span className="inline-flex items-center gap-0.5 text-emerald-600 text-[12px] font-semibold"><ArrowUpRight className="w-3 h-3" />Over</span>
                                          : <span className="inline-flex items-center gap-0.5 text-red-500 text-[12px] font-semibold"><ArrowDownRight className="w-3 h-3" />Under</span>
                                        }
                                      </td>
                                      <td className="py-2 px-3 text-right text-[12px] text-navy-600">
                                        {cl.size.toLocaleString()} ({cl.size_pct.toFixed(1)}%)
                                      </td>
                                      <td className="py-2 pl-3 text-right font-mono text-[12px] font-semibold text-navy-800">
                                        {cl.opportunity_score.toFixed(1)}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {!kpiLiftResult && !kpiLiftLoading && (
                      <div className="text-[14px] text-navy-500 py-8 text-center">
                        Select a KPI column to see lift analysis across all clusters.
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Persona Tab ─── */}
                {activeTab === "persona" && (
                  <div>
                    {personaLoading ? (
                      <div className="flex items-center gap-2 text-[14px] text-navy-500 py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                        Generating persona...
                      </div>
                    ) : persona && persona.cluster_id === selectedCluster ? (
                      <div>
                        <div className="bg-gradient-to-br from-brand-50 to-white rounded-2xl border border-brand-100 p-6 mb-6">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                              <User className="w-6 h-6 text-brand-600" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-xl font-bold tracking-tight text-navy-900">
                                  {contextCache[selectedCluster]?.segment_label || `Cluster ${selectedCluster}`}
                                </h3>
                                <span className="px-2 py-0.5 text-[11px] rounded-full bg-brand-100 text-brand-700 font-semibold">
                                  {selectedClusterData.size.toLocaleString()} members
                                </span>
                              </div>
                              <p className="text-[14px] text-navy-700 leading-relaxed italic">
                                {persona.persona}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Key traits as chips */}
                        <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest mb-2">
                          Key Traits
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedClusterData.feature_means).slice(0, 8).map(([feat, val]) => (
                            <span key={feat}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-full bg-navy-50 border border-navy-200 text-navy-700">
                              <span className="font-semibold">{feat}:</span>
                              <span className="font-mono font-bold">{val.toFixed(2)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[14px] text-navy-500 py-8 text-center">
                        Loading persona for this cluster...
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Actions Tab ─── */}
                {activeTab === "actions" && (
                  <div>
                    {actionsLoading ? (
                      <div className="flex items-center gap-2 text-[14px] text-navy-500 py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                        Generating recommended actions...
                      </div>
                    ) : actionsResult && actionsResult.cluster_id === selectedCluster ? (
                      <div>
                        <div className="text-[14px] text-navy-600 mb-5">
                          Prescriptive actions for <span className="font-semibold">{contextCache[selectedCluster]?.segment_label || `Cluster ${selectedCluster}`}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {actionsResult.actions.map((action, i) => (
                            <div key={i} className="bg-white rounded-2xl border border-navy-200 shadow-card p-6 hover:shadow-card-hover transition-all duration-200">
                              <div className="flex items-start justify-between mb-2">
                                <h4 className="text-[16px] font-bold text-navy-800 flex-1">{action.title}</h4>
                                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                                  <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    action.priority === "high" ? "bg-red-50 text-red-700"
                                    : action.priority === "medium" ? "bg-amber-50 text-amber-700"
                                    : "bg-navy-100 text-navy-600"
                                  }`}>
                                    {action.priority}
                                  </span>
                                  <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    action.effort === "low" ? "bg-emerald-50 text-emerald-700"
                                    : action.effort === "medium" ? "bg-amber-50 text-amber-700"
                                    : "bg-red-50 text-red-700"
                                  }`}>
                                    {action.effort} effort
                                  </span>
                                </div>
                              </div>
                              <p className="text-[13px] text-navy-600 leading-relaxed mb-3">{action.description}</p>
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-full bg-brand-50 text-brand-700 border border-brand-100">
                                  <Target className="w-3 h-3" />{action.target_kpi}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-bold rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100">
                                  <ArrowUpRight className="w-3 h-3" />{action.expected_lift}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[14px] text-navy-500 py-8 text-center">
                        Loading actions for this cluster...
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Compare Tab ─── */}
                {activeTab === "compare" && (
                  <div>
                    <div className="flex items-center gap-3 mb-5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: CLUSTER_COLORS[selectedCluster % CLUSTER_COLORS.length] }} />
                        <span className="text-[15px] font-semibold text-navy-700">
                          Cluster {selectedCluster}
                          {contextCache[selectedCluster] && (
                            <span className="text-navy-400 ml-1">({contextCache[selectedCluster].segment_label})</span>
                          )}
                        </span>
                      </div>
                      <span className="text-[14px] text-navy-400">vs</span>
                      <select
                        value={compareWith}
                        onChange={e => {
                          const val = e.target.value;
                          setCompareWith(val === "" ? "" : Number(val));
                          if (val !== "") {
                            handleCompare(selectedCluster, Number(val));
                          } else {
                            setCompareResult(null);
                          }
                        }}
                        className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 min-w-[160px]">
                        <option value="">Select cluster...</option>
                        {result.clusters
                          .filter(c => c.cluster_id !== selectedCluster)
                          .map(c => (
                            <option key={c.cluster_id} value={c.cluster_id}>
                              Cluster {c.cluster_id}{contextCache[c.cluster_id] ? ` - ${contextCache[c.cluster_id].segment_label}` : ""}
                            </option>
                          ))}
                      </select>
                      {compareLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-500" />}
                    </div>

                    {compareResult && (
                      <div>
                        <p className="text-[14px] text-navy-600 mb-5 leading-relaxed">{compareResult.summary}</p>

                        {/* Side-by-side cards */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          {[compareResult.cluster_a, compareResult.cluster_b].map(cid => {
                            const cData = result.clusters.find(c => c.cluster_id === cid);
                            if (!cData) return null;
                            return (
                              <div key={cid} className="bg-white rounded-2xl border border-navy-200 shadow-card p-6">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: CLUSTER_COLORS[cid % CLUSTER_COLORS.length] }} />
                                  <span className="text-[16px] font-bold text-navy-800">
                                    Cluster {cid}
                                  </span>
                                  {contextCache[cid] && (
                                    <span className="text-[13px] text-brand-600">{contextCache[cid].segment_label}</span>
                                  )}
                                </div>
                                <div className="text-[14px] text-navy-500 mb-2">
                                  {cData.size.toLocaleString()} ({cData.percentage.toFixed(1)}%)
                                </div>
                                <div className="space-y-1">
                                  {Object.entries(cData.feature_means).slice(0, 6).map(([feat, val]) => (
                                    <div key={feat} className="flex items-center justify-between text-[13px]">
                                      <span className="text-navy-600 truncate mr-2">{feat}</span>
                                      <span className="font-mono text-navy-800">{val.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Differences */}
                        <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest mb-2">
                          Feature Differences
                        </div>
                        <div className="space-y-1">
                          {compareResult.differences.slice(0, 10).map(d => (
                            <div key={d.feature} className="flex items-center justify-between text-[13px] py-1 border-b border-navy-50">
                              <span className="text-navy-600 truncate mr-2 font-mono">{d.feature}</span>
                              <div className="flex items-center gap-1 font-mono shrink-0">
                                <span className="text-navy-500">{d.cluster_a_value.toFixed(2)}</span>
                                <ArrowRight className="w-3 h-3 text-navy-400" />
                                <span className="text-navy-800 font-semibold">{d.cluster_b_value.toFixed(2)}</span>
                                <span className={`text-[11px] ml-1 font-bold ${d.delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {d.delta > 0 ? "+" : ""}{d.delta.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!compareResult && !compareLoading && (
                      <div className="text-[14px] text-navy-500 py-8 text-center">
                        Select a cluster to compare against.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Prompt to select a cluster */}
          {selectedCluster === null && (
            <div className="mt-5 bg-white rounded-2xl border border-navy-200 shadow-card p-8 text-center">
              <BarChart3 className="w-8 h-8 text-navy-300 mx-auto mb-2" />
              <div className="text-[15px] font-semibold text-navy-700 mb-1">Select a segment to explore</div>
              <div className="text-[13px] text-navy-500">Click a cluster card above or a point in the scatter plot</div>
            </div>
          )}
        </div>
      )}

      {/* CoPilot floating panel */}
      {result && (
        <CoPilotPanel
          clusters={result.clusters}
          tableLabel={tableLabel}
        />
      )}
    </div>
  );
}
