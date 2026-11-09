import { useState, useEffect } from "react";
import {
  submitFeatures, getInventory, getInventoryLogs,
  approveFeature, rejectFeature, materializeFeatures,
} from "../api";
import type { FeatureRule, InventoryItem, LogEntry, ProjectDetail, VarCategory } from "../api";
import { RULE_CATEGORY, VAR_CATEGORY_LABELS } from "../api";
import {
  Loader2, CheckCircle2, XCircle, Clock, Package, History,
  Send, Play, ChevronDown, ChevronRight, CheckSquare, Square,
} from "lucide-react";

interface Props {
  project: ProjectDetail;
  variables: FeatureRule[];
  onRefresh: () => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_APPROVAL: { bg: "bg-amber-100", text: "text-amber-700", label: "Pending Approval" },
  APPROVED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Approved" },
  REJECTED: { bg: "bg-red-100", text: "text-red-700", label: "Rejected" },
  MATERIALIZED: { bg: "bg-blue-100", text: "text-blue-700", label: "Materialized" },
};

export default function ReviewPage({ project, variables, onRefresh }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"submit" | "review" | "logs">(variables.length > 0 ? "submit" : "review");
  const [expandedId, setExpandedId] = useState("");
  const [actionLoading, setActionLoading] = useState("");

  // Submit state
  const [selected, setSelected] = useState<Set<string>>(new Set(variables.map(v => v.id)));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      getInventory(project.project_id),
      getInventoryLogs(),
    ]).then(([inv, l]) => {
      setItems(inv);
      // Filter logs to this project's features
      const fids = new Set(inv.map(i => i.feature_id));
      setLogs(l.filter(log => fids.has(log.feature_id)));
    }).finally(() => setLoading(false));
  };

  useEffect(load, [project.project_id]);
  useEffect(() => { setSelected(new Set(variables.map(v => v.id))); }, [variables]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedVars = variables.filter(v => selected.has(v.id));

  // Group variables by category
  const grouped: Record<VarCategory, FeatureRule[]> = {
    transform: [], binning: [], encoding: [], imputation: [], derived: [],
  };
  variables.forEach(v => {
    const cat = RULE_CATEGORY[v.type] || "derived";
    grouped[cat].push(v);
  });

  const handleSubmit = async () => {
    if (selectedVars.length === 0) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const r = await submitFeatures({
        project_id: project.project_id,
        source_catalog: project.catalog,
        source_schema: project.schema_name,
        source_table: project.source_table,
        output_catalog: project.output_catalog,
        output_schema: project.output_schema,
        output_table: project.output_table,
        rules: selectedVars,
        notes,
      });
      setSubmitResult({ type: "success", message: `${r.featureIds.length} variable(s) submitted for approval` });
      load();
      onRefresh();
    } catch (err) {
      setSubmitResult({ type: "error", message: err instanceof Error ? err.message : "Submission failed" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    await approveFeature(id);
    load(); onRefresh();
    setActionLoading("");
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    await rejectFeature(id);
    load(); onRefresh();
    setActionLoading("");
  };

  const handleMaterialize = async () => {
    setActionLoading("mat");
    try {
      await materializeFeatures(project.output_catalog, project.output_schema, project.output_table);
      load(); onRefresh();
    } finally {
      setActionLoading("");
    }
  };

  const pendingCount = items.filter(i => i.status === "PENDING_APPROVAL").length;
  const approvedCount = items.filter(i => i.status === "APPROVED").length;
  const materializedCount = items.filter(i => i.status === "MATERIALIZED").length;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-navy-800">Review & Approve</h2>
          <p className="text-sm text-navy-500 mt-0.5">
            Output: <span className="font-mono">{project.output_catalog}.{project.output_schema}.{project.output_table}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
              {pendingCount} pending
            </span>
          )}
          {approvedCount > 0 && (
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
              {approvedCount} approved
            </span>
          )}
          {materializedCount > 0 && (
            <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
              {materializedCount} materialized
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-lg border border-navy-100 p-1">
        {variables.length > 0 && (
          <button onClick={() => setTab("submit")}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
              tab === "submit" ? "bg-navy-800 text-white" : "text-navy-600 hover:bg-navy-50"
            }`}>
            <Send className="w-3.5 h-3.5" />Submit ({variables.length})
          </button>
        )}
        <button onClick={() => setTab("review")}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
            tab === "review" ? "bg-navy-800 text-white" : "text-navy-600 hover:bg-navy-50"
          }`}>
          <Package className="w-3.5 h-3.5" />Submitted ({items.length})
        </button>
        <button onClick={() => setTab("logs")}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
            tab === "logs" ? "bg-navy-800 text-white" : "text-navy-600 hover:bg-navy-50"
          }`}>
          <History className="w-3.5 h-3.5" />Audit Trail
        </button>
      </div>

      {/* ===== SUBMIT TAB ===== */}
      {tab === "submit" && (
        <div className="space-y-4">
          {variables.length === 0 ? (
            <div className="bg-white rounded-lg border border-navy-100 p-10 text-center">
              <Package className="w-10 h-10 text-navy-300 mx-auto mb-3" />
              <div className="text-sm font-medium text-navy-700 mb-1">No variables to submit</div>
              <div className="text-sm text-navy-500">Go to Derive Variables to create feature engineering rules first</div>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg border border-navy-100">
                <div className="px-4 py-3 border-b border-navy-100 flex items-center justify-between">
                  <span className="text-sm font-medium text-navy-700">Select Variables ({selectedVars.length}/{variables.length})</span>
                  <div className="flex gap-3">
                    <button onClick={() => setSelected(new Set(variables.map(v => v.id)))} className="text-xs text-brand-500 hover:text-brand-600 font-medium">All</button>
                    <button onClick={() => setSelected(new Set())} className="text-xs text-navy-500 hover:text-navy-700 font-medium">None</button>
                  </div>
                </div>
                <div className="divide-y divide-navy-50 max-h-[320px] overflow-y-auto">
                  {(Object.entries(grouped) as [VarCategory, FeatureRule[]][])
                    .filter(([, vars]) => vars.length > 0)
                    .map(([cat, vars]) => (
                      <div key={cat}>
                        <div className="px-4 py-1.5 bg-navy-50 text-xs font-medium text-navy-500 uppercase tracking-wider">
                          {VAR_CATEGORY_LABELS[cat]} ({vars.length})
                        </div>
                        {vars.map(v => (
                          <div key={v.id} className="flex items-center gap-3 px-4 py-2 hover:bg-navy-50 cursor-pointer" onClick={() => toggle(v.id)}>
                            {selected.has(v.id)
                              ? <CheckSquare className="w-4 h-4 text-brand-500 shrink-0" />
                              : <Square className="w-4 h-4 text-navy-300 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono text-navy-800 truncate">{v.outputColumn}</span>
                                <span className="text-xs text-navy-500">{v.name}</span>
                              </div>
                              {v.notes && <div className="text-xs text-navy-400 truncate mt-0.5">{v.notes}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-navy-100 p-4">
                <label className="block text-sm font-medium text-navy-700 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full text-sm px-3 py-2 border border-navy-200 rounded-lg text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="Describe these features..." />
              </div>

              {submitResult && (
                <div className={`rounded-lg p-4 ${submitResult.type === "success" ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
                  <div className="flex items-center gap-2">
                    {submitResult.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                    <span className={`text-sm font-medium ${submitResult.type === "success" ? "text-emerald-800" : "text-red-800"}`}>{submitResult.message}</span>
                  </div>
                </div>
              )}

              <button onClick={handleSubmit} disabled={submitting || selectedVars.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-40 transition-colors">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Submit {selectedVars.length} Variable(s) for Approval
              </button>
            </>
          )}
        </div>
      )}

      {/* ===== REVIEW TAB ===== */}
      {tab === "review" && (
        loading ? (
          <div className="flex items-center justify-center h-48 text-navy-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg border border-navy-100 p-10 text-center text-navy-400 text-sm">
            No features submitted yet for this project.
          </div>
        ) : (
          <div className="space-y-3">
            {approvedCount > 0 && (
              <div className="flex justify-end">
                <button onClick={handleMaterialize} disabled={actionLoading === "mat"}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50">
                  {actionLoading === "mat" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Materialize {approvedCount} Approved Feature(s) to Delta
                </button>
              </div>
            )}
            <div className="bg-white rounded-lg border border-navy-100">
              {items.map(item => {
                const expanded = expandedId === item.feature_id;
                const itemLogs = logs.filter(l => l.feature_id === item.feature_id);
                const st = STATUS_STYLES[item.status] || { bg: "bg-navy-100", text: "text-navy-600", label: item.status };
                return (
                  <div key={item.feature_id} className="border-b border-navy-50 last:border-0">
                    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-navy-50 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? "" : item.feature_id)}>
                      {expanded ? <ChevronDown className="w-4 h-4 text-navy-400" /> : <ChevronRight className="w-4 h-4 text-navy-400" />}
                      <span className="text-sm font-mono text-navy-800 w-48 truncate">{item.output_column}</span>
                      <span className="text-xs text-navy-500">{item.rule_type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${st.bg} ${st.text}`}>
                        {st.label}
                      </span>
                      <span className="text-xs text-navy-400 ml-auto">{item.created_by?.split("@")[0] || "?"}</span>
                      <span className="text-xs text-navy-400">{item.created_at}</span>

                      {item.status === "PENDING_APPROVAL" && (
                        <div className="flex gap-1 ml-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleApprove(item.feature_id)} disabled={actionLoading === item.feature_id}
                            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-md hover:bg-emerald-100 border border-emerald-200">
                            {actionLoading === item.feature_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Approve
                          </button>
                          <button onClick={() => handleReject(item.feature_id)} disabled={actionLoading === item.feature_id}
                            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 border border-red-200">
                            <XCircle className="w-3 h-3" />Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="px-8 pb-3 text-sm">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div><span className="text-navy-500">Source: </span><span className="font-mono text-navy-700">{item.source_catalog}.{item.source_schema}.{item.source_table}</span></div>
                          <div><span className="text-navy-500">Params: </span><span className="font-mono text-navy-700">{item.rule_params}</span></div>
                          {item.approved_by && <div><span className="text-navy-500">Approved by: </span><span className="text-navy-700">{item.approved_by}</span></div>}
                          {item.notes && <div className="col-span-2"><span className="text-navy-500">Notes: </span><span className="text-navy-700">{item.notes}</span></div>}
                        </div>
                        {itemLogs.length > 0 && (
                          <div className="border-t border-navy-100 pt-2 mt-2">
                            <div className="text-xs text-navy-500 font-medium mb-1">Activity</div>
                            {itemLogs.map(l => (
                              <div key={l.log_id} className="flex items-center gap-2 text-xs py-0.5">
                                <Clock className="w-3 h-3 text-navy-400" />
                                <span className="text-navy-400">{l.action_time}</span>
                                <span className="font-medium text-navy-600">{l.action}</span>
                                <span className="text-navy-500">by {l.actor?.split("@")[0]}</span>
                                {l.details && <span className="text-navy-400">— {l.details}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* ===== AUDIT TRAIL TAB ===== */}
      {tab === "logs" && (
        <div className="bg-white rounded-lg border border-navy-100">
          {logs.length === 0 ? (
            <div className="p-10 text-center text-navy-400 text-sm">No audit logs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy-50 text-navy-600">
                    <th className="px-3 py-2 text-left font-medium">Time</th>
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                    <th className="px-3 py-2 text-left font-medium">Feature ID</th>
                    <th className="px-3 py-2 text-left font-medium">Actor</th>
                    <th className="px-3 py-2 text-left font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => {
                    const actionStyle = l.action === "APPROVED" ? "bg-emerald-100 text-emerald-700" :
                      l.action === "REJECTED" ? "bg-red-100 text-red-700" :
                      l.action === "MATERIALIZED" ? "bg-blue-100 text-blue-700" :
                      "bg-navy-100 text-navy-600";
                    return (
                      <tr key={l.log_id} className="border-b border-navy-50 hover:bg-navy-50">
                        <td className="px-3 py-2 text-navy-500 whitespace-nowrap">{l.action_time}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionStyle}`}>{l.action}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-navy-600">{l.feature_id}</td>
                        <td className="px-3 py-2 text-navy-700">{l.actor}</td>
                        <td className="px-3 py-2 text-navy-500 max-w-[300px] truncate">{l.details}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
