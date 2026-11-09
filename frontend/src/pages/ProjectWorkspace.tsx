import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getProject, getInventory } from "../api";
import type { ProjectDetail, FeatureRule, SourceTableRef, InventoryItem } from "../api";
import {
  Search, GitBranch, Shield, Loader2, ArrowLeft,
  Database, X, ChevronDown, Zap, ChevronRight, Package,
} from "lucide-react";
import { RULE_CATEGORY, VAR_CATEGORY_LABELS } from "../api";
import type { VarCategory } from "../api";
import ExplorePage from "./ExplorePage";
import VariablesPage from "./VariablesPage";
import ReviewPage from "./ReviewPage";

export interface TableRef {
  catalog: string;
  schema: string;
  table: string;
  label: string;
}

type Tab = "explore" | "variables" | "review" | "inventory";

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  PENDING_APPROVAL: { dot: "bg-amber-400", label: "Pending" },
  APPROVED: { dot: "bg-emerald-400", label: "Approved" },
  REJECTED: { dot: "bg-red-400", label: "Rejected" },
  MATERIALIZED: { dot: "bg-blue-400", label: "Materialized" },
};

const TABS: { id: Tab; label: string; icon: typeof Search; step?: number }[] = [
  { id: "explore", label: "Explore Data", icon: Search, step: 1 },
  { id: "variables", label: "Derive Variables", icon: GitBranch, step: 2 },
  { id: "review", label: "Review & Approve", icon: Shield, step: 3 },
  { id: "inventory", label: "Feature Inventory", icon: Zap },
];

function buildTableRefs(project: ProjectDetail): TableRef[] {
  if (project.tables && project.tables.length > 0) {
    return project.tables.map((t: SourceTableRef) => ({
      catalog: t.catalog,
      schema: t.schema_name,
      table: t.table,
      label: `${t.catalog}.${t.schema_name}.${t.table}`,
    }));
  }
  return [{
    catalog: project.catalog,
    schema: project.schema_name,
    table: project.source_table,
    label: `${project.catalog}.${project.schema_name}.${project.source_table}`,
  }];
}

export default function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("explore");
  const [variables, setVariables] = useState<FeatureRule[]>([]);
  const [activeTableIdx, setActiveTableIdx] = useState(0);
  const [showTablePicker, setShowTablePicker] = useState(false);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [invLoading, setInvLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    getProject(projectId).then(setProject).finally(() => setLoading(false));
  }, [projectId]);

  const loadInventory = useCallback(() => {
    if (!projectId) return;
    setInvLoading(true);
    getInventory(projectId).then(setInventory).finally(() => setInvLoading(false));
  }, [projectId]);

  useEffect(loadInventory, [loadInventory]);

  const addVariable = (v: FeatureRule) => setVariables(prev => [...prev, v]);
  const removeVariable = (id: string) => setVariables(prev => prev.filter(v => v.id !== id));

  const handleRefresh = () => {
    if (projectId) getProject(projectId).then(setProject);
    loadInventory();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-navy-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading project...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-navy-400">
        <div className="text-lg font-semibold mb-2">Project not found</div>
        <button onClick={() => navigate("/projects")} className="text-[15px] text-brand-500 hover:underline font-medium">
          Back to Projects
        </button>
      </div>
    );
  }

  const tableRefs = buildTableRefs(project);
  const tableRef = tableRefs[activeTableIdx] || tableRefs[0];
  const multiTable = tableRefs.length > 1;

  const invByStatus = inventory.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex h-full">
      {/* Project sidebar */}
      <div className="w-[260px] bg-white border-r border-navy-200 flex flex-col shrink-0">
        {/* Project header */}
        <div className="px-5 py-4 border-b border-navy-200">
          <button onClick={() => navigate("/projects")}
            className="flex items-center gap-1.5 text-[13px] text-navy-400 hover:text-brand-500 mb-3 transition-colors font-medium">
            <ArrowLeft className="w-3.5 h-3.5" />Back to Projects
          </button>
          <div className="text-[16px] font-bold text-navy-900 truncate tracking-tight">{project.name}</div>

          {/* Table switcher */}
          {multiTable ? (
            <div className="relative mt-2">
              <button onClick={() => setShowTablePicker(!showTablePicker)}
                className="w-full flex items-center gap-1.5 text-[13px] text-navy-500 bg-navy-50 px-3 py-2 rounded-xl border border-navy-200 hover:border-brand-300 transition-colors">
                <Database className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono truncate flex-1 text-left">{tableRef.table}</span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${showTablePicker ? "rotate-180" : ""}`} />
              </button>
              {showTablePicker && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTablePicker(false)} />
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-navy-200 rounded-xl shadow-elevated z-20 py-1.5 max-h-48 overflow-y-auto">
                    {tableRefs.map((t, i) => (
                      <button key={i} onClick={() => { setActiveTableIdx(i); setShowTablePicker(false); }}
                        className={`w-full px-4 py-2.5 text-left text-[13px] font-mono truncate transition-colors ${
                          i === activeTableIdx ? "bg-brand-50 text-brand-700 font-semibold" : "text-navy-700 hover:bg-navy-50"
                        }`}>
                        <span className="text-navy-400 font-sans">{t.schema}.</span>{t.table}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="text-[11px] text-navy-400 mt-1.5 px-1 font-medium">{tableRefs.length} tables in project</div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[13px] text-navy-400 mt-1.5">
              <Database className="w-3.5 h-3.5" />
              <span className="font-mono truncate">{tableRef.label}</span>
            </div>
          )}
        </div>

        {/* Workflow steps */}
        <div className="px-3 py-4 border-b border-navy-200">
          <div className="text-[11px] font-semibold text-navy-400 uppercase tracking-widest px-3 mb-2">
            Workflow
          </div>
          {TABS.slice(0, 3).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            const badge = t.id === "variables" && variables.length > 0 ? variables.length : 0;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 mb-0.5 rounded-xl text-left text-[14px] font-medium transition-all duration-200 ${
                  active
                    ? "bg-brand-50 text-brand-600"
                    : "text-navy-600 hover:bg-navy-50"
                }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  active ? "bg-brand-500 text-white" : "bg-navy-200 text-navy-500"
                }`}>{t.step}</div>
                <Icon className="w-4 h-4 shrink-0" />
                {t.label}
                {badge > 0 && (
                  <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-600 font-bold">{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Feature Inventory */}
        <div className="flex-1 overflow-y-auto">
          <button onClick={() => setTab("inventory")}
            className={`w-full flex items-center gap-2.5 px-5 py-3.5 text-left text-[14px] font-semibold border-b border-navy-200 transition-colors ${
              tab === "inventory" ? "bg-brand-50 text-brand-600" : "text-navy-700 hover:bg-navy-50"
            }`}>
            <Zap className="w-4 h-4 shrink-0" />
            Feature Inventory
            {inventory.length > 0 && (
              <span className="ml-auto text-[12px] px-2 py-0.5 rounded-full bg-navy-100 text-navy-600 font-bold">{inventory.length}</span>
            )}
          </button>

          {inventory.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-navy-400">
              {invLoading ? "Loading..." : "No features submitted yet"}
            </div>
          ) : (
            <div className="px-3 py-3">
              {/* Status summary */}
              <div className="flex flex-wrap gap-2 mb-3 px-2">
                {Object.entries(invByStatus).map(([status, count]) => {
                  const st = STATUS_STYLES[status];
                  if (!st) return null;
                  return (
                    <span key={status} className="inline-flex items-center gap-1.5 text-[11px] text-navy-500 font-medium">
                      <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                      {count} {st.label}
                    </span>
                  );
                })}
              </div>

              {/* Feature list */}
              <div className="space-y-0.5">
                {inventory.map(item => {
                  const st = STATUS_STYLES[item.status] || { dot: "bg-navy-300", label: item.status };
                  return (
                    <Link key={item.feature_id} to={`/features/${item.feature_id}`}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] hover:bg-navy-50 group transition-colors">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                      <span className="font-mono text-navy-700 truncate flex-1">{item.output_column}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-navy-300 opacity-0 group-hover:opacity-100 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto p-6">
        {tab === "explore" && <ExplorePage table={tableRef} />}
        {tab === "variables" && (
          <VariablesPage table={tableRef} variables={variables}
            onAdd={addVariable} onRemove={removeVariable} />
        )}
        {tab === "review" && (
          <ReviewPage project={project} variables={variables}
            onRefresh={handleRefresh} />
        )}
        {tab === "inventory" && (
          <ProjectInventory inventory={inventory} loading={invLoading}
            onRefresh={loadInventory} projectName={project.name} />
        )}
      </div>
    </div>
  );
}

/* -- Project-scoped Feature Inventory -- */

const STATUS_TABLE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_APPROVAL: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  APPROVED: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" },
  REJECTED: { bg: "bg-red-50", text: "text-red-700", label: "Rejected" },
  MATERIALIZED: { bg: "bg-blue-50", text: "text-blue-700", label: "Materialized" },
};

const CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform", binning: "Binning", encoding: "Encoding",
  imputation: "Imputation", derived: "Derived",
};

function ProjectInventory({ inventory, loading, onRefresh, projectName }: {
  inventory: InventoryItem[];
  loading: boolean;
  onRefresh: () => void;
  projectName: string;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const filtered = inventory.filter(item => {
    if (search && !item.output_column.toLowerCase().includes(search.toLowerCase()) &&
        !item.rule_type.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (typeFilter && (RULE_CATEGORY[item.rule_type] || "derived") !== typeFilter) return false;
    return true;
  });

  const statusCounts = inventory.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-navy-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading inventory...
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy-900 tracking-tight">Feature Inventory</h2>
            <p className="text-[14px] text-navy-500 mt-0.5">
              {inventory.length} feature(s) in {projectName}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {Object.entries(statusCounts).map(([status, count]) => {
            const st = STATUS_TABLE_STYLES[status];
            return st ? (
              <span key={status} className={`px-3 py-1.5 text-[13px] font-semibold rounded-full ${st.bg} ${st.text}`}>
                {count} {st.label}
              </span>
            ) : null;
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400" />
          <input type="text" placeholder="Search features..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 text-[15px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_TABLE_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800">
          <option value="">All Types</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-14 text-center">
          <div className="w-14 h-14 rounded-2xl bg-navy-100 flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7 text-navy-400" />
          </div>
          <div className="text-lg font-semibold text-navy-800 mb-2">
            {inventory.length === 0 ? "No features submitted yet" : "No features match your filters"}
          </div>
          <div className="text-[15px] text-navy-500">
            {inventory.length === 0 ? "Create variables in Derive Variables and submit them for approval" : "Try adjusting your search or filters"}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="bg-navy-50 text-navy-600 border-b border-navy-200">
                <th className="px-5 py-3.5 text-left font-semibold">Feature Name</th>
                <th className="px-5 py-3.5 text-left font-semibold">Type</th>
                <th className="px-5 py-3.5 text-left font-semibold">Source Table</th>
                <th className="px-5 py-3.5 text-left font-semibold">Status</th>
                <th className="px-5 py-3.5 text-left font-semibold">Created</th>
                <th className="px-5 py-3.5 text-left font-semibold">Notes</th>
                <th className="px-5 py-3.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const st = STATUS_TABLE_STYLES[item.status] || { bg: "bg-navy-100", text: "text-navy-600", label: item.status };
                const category = RULE_CATEGORY[item.rule_type] || "derived";
                return (
                  <tr key={item.feature_id}
                    onClick={() => navigate(`/features/${item.feature_id}`)}
                    className="border-b border-navy-100 hover:bg-navy-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-semibold text-navy-800">{item.output_column}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[12px] px-2.5 py-1 rounded-lg bg-navy-100 text-navy-600 font-semibold">
                        {CATEGORY_LABELS[category] || category}
                      </span>
                      <span className="text-navy-400 ml-2 text-[13px]">{item.rule_type}</span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-navy-600 text-[13px]">
                      {item.source_table}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[12px] px-2.5 py-1 rounded-lg font-semibold ${st.bg} ${st.text}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-navy-500 text-[13px]">
                      {item.created_by?.split("@")[0]}<br />{item.created_at?.split(" ")[0]}
                    </td>
                    <td className="px-5 py-3.5 text-navy-500 text-[13px] max-w-[200px] truncate">
                      {item.notes || "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <ChevronRight className="w-4 h-4 text-navy-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
