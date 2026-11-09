import { useState, useEffect, useCallback } from "react";
import { getProfile, getDistribution, getCorrelations } from "../api";
import type { ProfileResult, ProfileColumn, DistributionResult, CorrelationResult } from "../api";
import type { TableRef } from "./ProjectWorkspace";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  Loader2, AlertTriangle, Hash, Type, Rows3, Columns3, AlertCircle, ChevronDown, ChevronRight, Grid3X3,
} from "lucide-react";

type Tab = "overview" | "variables" | "correlations" | "missing" | "sample";

interface Props { table: TableRef }

export default function ExplorePage({ table }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [corrResult, setCorrResult] = useState<CorrelationResult | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [expandedVar, setExpandedVar] = useState<string>("");
  const [distData, setDistData] = useState<Record<string, DistributionResult>>({});
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, string>[] } | null>(null);

  const { catalog, schema: sch, table: tbl } = table;

  useEffect(() => {
    setProfile(null); setCorrResult(null); setDistData({}); setExpandedVar("");
    setLoading(true);
    getProfile(catalog, sch, tbl).then(setProfile).finally(() => setLoading(false));
  }, [catalog, sch, tbl]);

  useEffect(() => {
    if (tab === "sample" && !preview) {
      import("../api").then(api => api.getTablePreview(catalog, sch, tbl).then(setPreview));
    }
  }, [tab, preview, catalog, sch, tbl]);

  const loadCorr = useCallback(() => {
    if (corrResult || !profile || corrLoading) return;
    const cols = profile.columns.filter(c => c.isNumeric).map(c => c.name).slice(0, 30);
    if (cols.length < 2) return;
    setCorrLoading(true);
    getCorrelations(catalog, sch, tbl, cols).then(setCorrResult).finally(() => setCorrLoading(false));
  }, [catalog, sch, tbl, profile, corrResult, corrLoading]);

  useEffect(() => { if (tab === "correlations") loadCorr(); }, [tab, loadCorr]);

  const loadDist = (col: string) => {
    if (distData[col]) return;
    getDistribution(catalog, sch, tbl, col).then(d => setDistData(prev => ({ ...prev, [col]: d })));
  };

  const toggleVar = (name: string) => {
    if (expandedVar === name) { setExpandedVar(""); }
    else { setExpandedVar(name); loadDist(name); }
  };

  const fmt = (v: number | null | undefined) => v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";

  if (loading) return <div className="flex items-center justify-center h-64 text-navy-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Profiling table...</div>;
  if (!profile) return null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" }, { id: "variables", label: `Variables (${profile.colCount})` },
    { id: "correlations", label: "Correlations" }, { id: "missing", label: "Missing Values" }, { id: "sample", label: "Sample" },
  ];

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-lg border border-navy-100 p-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded transition-colors ${tab === t.id ? "bg-navy-800 text-white" : "text-navy-600 hover:bg-navy-50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW ===== */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-6 gap-3">
            {[
              { label: "Rows", val: profile.rowCount.toLocaleString(), icon: <Rows3 className="w-4 h-4" /> },
              { label: "Columns", val: profile.colCount, icon: <Columns3 className="w-4 h-4" /> },
              { label: "Numeric", val: profile.numericCount, icon: <Hash className="w-4 h-4" /> },
              { label: "Categorical", val: profile.categoricalCount, icon: <Type className="w-4 h-4" /> },
              { label: "Missing Cells", val: profile.totalMissing.toLocaleString(), icon: <AlertCircle className="w-4 h-4" /> },
              { label: "Missing %", val: `${profile.totalMissingPct}%`, icon: <AlertTriangle className="w-4 h-4" /> },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-lg border border-navy-100 p-4">
                <div className="flex items-center gap-2 text-navy-400 mb-1">{s.icon}<span className="text-xs uppercase tracking-wider">{s.label}</span></div>
                <div className="text-xl font-semibold text-navy-900">{s.val}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg border border-navy-100 p-4 flex gap-8 items-center">
            <div className="w-36 h-36">
              <PieChart width={144} height={144}>
                <Pie data={[{ name: "Numeric", value: profile.numericCount }, { name: "Categorical", value: profile.categoricalCount }]}
                  cx={68} cy={68} innerRadius={32} outerRadius={60} dataKey="value" stroke="none">
                  <Cell fill="#FF3621" /><Cell fill="#293742" />
                </Pie>
                <Tooltip contentStyle={{ fontSize: 13 }} />
              </PieChart>
            </div>
            <div className="text-sm space-y-1.5">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-brand-500" /><span className="text-navy-700">Numeric: {profile.numericCount}</span></div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-navy-800" /><span className="text-navy-700">Categorical: {profile.categoricalCount}</span></div>
            </div>
          </div>
          {profile.alerts.length > 0 && (
            <div className="bg-white rounded-lg border border-navy-100 p-4">
              <h3 className="text-base font-semibold text-navy-800 mb-2">Alerts</h3>
              <div className="space-y-1.5">
                {profile.alerts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <AlertTriangle className={`w-4 h-4 ${a.type === "missing" ? "text-amber-500" : a.type === "skew" ? "text-orange-500" : "text-red-500"}`} />
                    <span className="font-mono text-navy-700">{a.column}</span>
                    <span className="text-navy-500">{a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== VARIABLES ===== */}
      {tab === "variables" && (
        <div className="space-y-2">
          {profile.columns.map((col: ProfileColumn) => {
            const expanded = expandedVar === col.name;
            const dist = distData[col.name];
            return (
              <div key={col.name} className="bg-white rounded-lg border border-navy-100">
                <button onClick={() => toggleVar(col.name)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-50 transition-colors">
                  {expanded ? <ChevronDown className="w-4 h-4 text-navy-400" /> : <ChevronRight className="w-4 h-4 text-navy-400" />}
                  <span className="text-sm font-mono font-medium text-navy-800 w-52 truncate">{col.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${col.isNumeric ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                    {col.isNumeric ? "Numeric" : "Categorical"}
                  </span>
                  <span className="text-xs text-navy-500">Distinct: {col.distinctCount.toLocaleString()}</span>
                  <span className={`text-xs ${col.nullPct > 5 ? "text-amber-600 font-medium" : "text-navy-500"}`}>Missing: {col.nullPct}%</span>
                  {col.isNumeric && <span className="text-xs text-navy-400 ml-auto">Mean: {fmt(col.mean)} | Std: {fmt(col.std)}</span>}
                  {!col.isNumeric && col.topValues && (
                    <span className="text-xs text-navy-400 ml-auto">Top: {col.topValues.slice(0, 3).map(v => `${v.value} (${v.pct}%)`).join(", ")}</span>
                  )}
                </button>
                {expanded && (
                  <div className="px-4 pb-4 border-t border-navy-100 pt-3">
                    <div className="grid grid-cols-[1fr_300px] gap-4">
                      <div>
                        {dist ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={dist.bins} margin={{ top: 5, right: 10, bottom: 30, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#D1D5DB" />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6B7280" }} angle={-30} textAnchor="end"
                                interval={dist.bins.length > 15 ? Math.floor(dist.bins.length / 8) : 0} />
                              <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                              <Tooltip contentStyle={{ fontSize: 13, border: "1px solid #D1D5DB", borderRadius: 6 }} />
                              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                                {dist.bins.map((_, i) => <Cell key={i} fill={col.isNumeric ? "#FF3621" : "#FF8676"} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="h-48 flex items-center justify-center text-navy-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...</div>}
                      </div>
                      <div className="text-sm space-y-1">
                        {col.isNumeric ? (
                          <>
                            {([
                              ["Min", col.min], ["Q1 (25%)", col.q1], ["Median", col.median], ["Q3 (75%)", col.q3], ["Max", col.max],
                              ["Mean", col.mean], ["Std Dev", col.std], ["Skewness", col.skewness], ["Kurtosis", col.kurtosis],
                              ["IQR", col.q1 != null && col.q3 != null ? (col.q3 - col.q1) : null],
                            ] as [string, number | null | undefined][]).map(([label, val]) => (
                              <div key={label} className="flex justify-between py-0.5 border-b border-navy-50">
                                <span className="text-navy-500">{label}</span>
                                <span className="font-mono text-navy-800">{fmt(val)}</span>
                              </div>
                            ))}
                          </>
                        ) : col.topValues ? (
                          <>
                            <div className="text-navy-500 font-medium mb-1">Top Values</div>
                            {col.topValues.map(v => (
                              <div key={v.value} className="flex justify-between py-0.5 border-b border-navy-50">
                                <span className="text-navy-700 truncate max-w-[160px]">{v.value}</span>
                                <span className="font-mono text-navy-600">{v.count.toLocaleString()} ({v.pct}%)</span>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== CORRELATIONS ===== */}
      {tab === "correlations" && (
        <div className="bg-white rounded-lg border border-navy-100 p-4">
          {corrLoading ? (
            <div className="flex items-center justify-center h-64 text-navy-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Computing correlations...</div>
          ) : corrResult ? (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-navy-800 flex items-center gap-2"><Grid3X3 className="w-4 h-4" />Pearson Correlation Matrix</h3>
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead><tr><th />{corrResult.columns.map(c => <th key={c} className="px-1 py-1 font-mono text-navy-600 font-normal" style={{ writingMode: "vertical-rl", maxHeight: 100 }}>{c}</th>)}</tr></thead>
                  <tbody>
                    {corrResult.matrix.map((row, i) => (
                      <tr key={i}><td className="pr-2 font-mono text-navy-600 text-right whitespace-nowrap">{corrResult.columns[i]}</td>
                        {row.map((val, j) => {
                          const abs = Math.abs(val);
                          const bg = i === j ? "#E5E7EB" : abs > 0.7 ? (val > 0 ? `rgba(16,185,129,${abs})` : `rgba(255,54,33,${abs})`) : `rgba(100,116,139,${abs * 0.3})`;
                          return <td key={j} className="px-1 py-0.5 text-center" style={{ backgroundColor: bg, color: abs > 0.5 ? "white" : "#374151", minWidth: 32 }}>{val.toFixed(2)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {corrResult.highCorrelations.length > 0 && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                  <strong>High Correlations Detected:</strong>
                  {corrResult.highCorrelations.map((h, i) => <span key={i} className="ml-2">{h.col_a} ↔ {h.col_b} ({h.value})</span>)}
                </div>
              )}
              {corrResult.vif.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold text-navy-800 mb-2">VIF</h3>
                  <div className="grid grid-cols-4 gap-2">
                    {corrResult.vif.sort((a, b) => (b.vif ?? 0) - (a.vif ?? 0)).map(v => (
                      <div key={v.column} className={`flex justify-between px-3 py-2 rounded text-sm ${v.vif && v.vif > 10 ? "bg-red-50 text-red-700" : v.vif && v.vif > 5 ? "bg-amber-50 text-amber-700" : "bg-navy-50 text-navy-700"}`}>
                        <span className="font-mono truncate">{v.column}</span><span className="font-medium ml-2">{v.vif?.toFixed(1) ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : <div className="text-center py-10 text-navy-400 text-sm">Need at least 2 numeric columns.</div>}
        </div>
      )}

      {/* ===== MISSING ===== */}
      {tab === "missing" && (
        <div className="bg-white rounded-lg border border-navy-100 p-4 space-y-2">
          {profile.columns.filter(c => c.nullCount > 0).length === 0 ? (
            <div className="text-center py-10 text-emerald-600 text-sm font-medium">No missing values detected.</div>
          ) : (
            profile.columns.filter(c => c.nullCount > 0).sort((a, b) => b.nullPct - a.nullPct).map(c => (
              <div key={c.name} className="flex items-center gap-3 text-sm">
                <span className="w-44 font-mono text-navy-800 truncate">{c.name}</span>
                <div className="flex-1 h-5 bg-navy-50 rounded overflow-hidden">
                  <div className={`h-full rounded ${c.nullPct > 50 ? "bg-red-400" : c.nullPct > 5 ? "bg-amber-400" : "bg-cyan-400"}`}
                    style={{ width: `${Math.max(2, c.nullPct)}%` }} />
                </div>
                <span className="w-14 text-right font-mono text-navy-600">{c.nullPct}%</span>
                <span className="w-20 text-right text-navy-500">{c.nullCount.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== SAMPLE ===== */}
      {tab === "sample" && (
        <div className="bg-white rounded-lg border border-navy-100 overflow-hidden">
          {preview ? (
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0"><tr className="bg-navy-50">{preview.columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium text-navy-600 whitespace-nowrap border-b border-navy-100">{c}</th>)}</tr></thead>
                <tbody>{preview.rows.map((r, i) => <tr key={i} className="border-b border-navy-50 hover:bg-navy-50">{preview.columns.map(c => <td key={c} className="px-3 py-1.5 text-navy-700 whitespace-nowrap max-w-[200px] truncate">{r[c] ?? "null"}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : <div className="flex items-center justify-center h-32 text-navy-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...</div>}
        </div>
      )}
    </div>
  );
}
