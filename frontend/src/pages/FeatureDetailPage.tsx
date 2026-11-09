import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getFeatureDetail, getDistribution } from "../api";
import type { FeatureDetail, DistributionResult } from "../api";
import { RULE_CATEGORY } from "../api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Loader2, ArrowLeft, Zap, FolderOpen, Clock, Code, BarChart3,
  GitBranch, Shield, Database,
} from "lucide-react";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_APPROVAL: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending Approval" },
  APPROVED: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" },
  REJECTED: { bg: "bg-red-50", text: "text-red-700", label: "Rejected" },
  MATERIALIZED: { bg: "bg-blue-50", text: "text-blue-700", label: "Materialized" },
};

const CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform", binning: "Binning", encoding: "Encoding",
  imputation: "Imputation", derived: "Derived",
};

export default function FeatureDetailPage() {
  const { featureId } = useParams<{ featureId: string }>();
  const navigate = useNavigate();
  const [feature, setFeature] = useState<FeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dist, setDist] = useState<DistributionResult | null>(null);
  const [tab, setTab] = useState<"overview" | "logic" | "exploration" | "audit">("overview");

  useEffect(() => {
    if (!featureId) return;
    setLoading(true);
    getFeatureDetail(featureId).then(f => {
      setFeature(f);
      try {
        const params = JSON.parse(f.rule_params);
        const col = params.column || params.numerator;
        if (col) {
          getDistribution(f.source_catalog, f.source_schema, f.source_table, col)
            .then(setDist).catch(() => {});
        }
      } catch {}
    }).finally(() => setLoading(false));
  }, [featureId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-navy-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading feature...
      </div>
    );
  }

  if (!feature) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-navy-400">
        <div className="text-lg font-semibold mb-2">Feature not found</div>
        <button onClick={() => navigate("/features")} className="text-[15px] text-brand-500 hover:underline">
          Back to Feature Inventory
        </button>
      </div>
    );
  }

  const st = STATUS_STYLES[feature.status] || { bg: "bg-navy-100", text: "text-navy-600", label: feature.status };
  const category = RULE_CATEGORY[feature.rule_type] || "derived";
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(feature.rule_params); } catch {}

  const TABS = [
    { id: "overview" as const, label: "Overview", icon: Zap },
    { id: "logic" as const, label: "Logic", icon: Code },
    { id: "exploration" as const, label: "Exploration", icon: BarChart3 },
    { id: "audit" as const, label: "Audit Trail", icon: Shield },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Breadcrumb + header */}
      <div className="mb-8">
        <button onClick={() => navigate("/features")}
          className="flex items-center gap-1.5 text-[14px] text-navy-400 hover:text-brand-500 mb-4 transition-colors font-medium">
          <ArrowLeft className="w-4 h-4" />Back to Feature Inventory
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-brand-600" />
          </div>
          <h1 className="text-2xl font-mono font-bold text-navy-900 tracking-tight">{feature.output_column}</h1>
          <span className={`text-[13px] px-3 py-1 rounded-lg font-semibold ${st.bg} ${st.text}`}>
            {st.label}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl shadow-card p-1.5 mb-6">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold rounded-lg transition-all duration-200 ${
                tab === t.id ? "bg-navy-900 text-white shadow-sm" : "text-navy-600 hover:bg-navy-50"
              }`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-card p-6">
            <div className="grid grid-cols-2 gap-5 text-[15px]">
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Feature Name</span>
                <span className="font-mono font-semibold text-navy-800 text-[16px]">{feature.output_column}</span>
              </div>
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Type</span>
                <span className="text-[13px] px-2.5 py-1 rounded-lg bg-navy-100 text-navy-600 font-semibold">
                  {CATEGORY_LABELS[category] || category}
                </span>
                <span className="text-navy-700 ml-2">{feature.rule_type}</span>
              </div>
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Source Table</span>
                <span className="font-mono text-navy-700 flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-navy-400" />
                  {feature.source_catalog}.{feature.source_schema}.{feature.source_table}
                </span>
              </div>
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Output Table</span>
                <span className="font-mono text-navy-700">
                  {feature.output_catalog}.{feature.output_schema}.{feature.output_table}
                </span>
              </div>
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Created By</span>
                <span className="text-navy-700">{feature.created_by}</span>
              </div>
              <div>
                <span className="text-navy-400 block mb-1 text-[13px] font-medium">Created At</span>
                <span className="text-navy-700">{feature.created_at}</span>
              </div>
              {feature.approved_by && (
                <>
                  <div>
                    <span className="text-navy-400 block mb-1 text-[13px] font-medium">Approved By</span>
                    <span className="text-navy-700">{feature.approved_by}</span>
                  </div>
                  <div>
                    <span className="text-navy-400 block mb-1 text-[13px] font-medium">Approved At</span>
                    <span className="text-navy-700">{feature.approved_at}</span>
                  </div>
                </>
              )}
              {feature.notes && (
                <div className="col-span-2">
                  <span className="text-navy-400 block mb-1 text-[13px] font-medium">Notes</span>
                  <span className="text-navy-700">{feature.notes}</span>
                </div>
              )}
            </div>
          </div>

          {feature.project && (
            <Link to={`/projects/${feature.project.project_id}`}
              className="block bg-white rounded-2xl shadow-card p-5 hover:shadow-card-hover transition-all duration-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-navy-100 flex items-center justify-center">
                  <FolderOpen className="w-5 h-5 text-navy-500" />
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-navy-800">{feature.project.name}</div>
                  <div className="text-[13px] text-navy-500">{feature.project.description || "Open project workspace"}</div>
                </div>
                <ArrowLeft className="w-4 h-4 text-navy-300 ml-auto rotate-180" />
              </div>
            </Link>
          )}
        </div>
      )}

      {/* LOGIC */}
      {tab === "logic" && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-card p-6">
            <h3 className="text-[16px] font-bold text-navy-800 mb-4 flex items-center gap-2">
              <GitBranch className="w-5 h-5" />Lineage
            </h3>
            <div className="flex items-center gap-4 text-[14px]">
              <div className="space-y-2">
                {Object.entries(params)
                  .filter(([k]) => ["column", "numerator", "denominator", "column_a", "column_b", "date_a", "date_b"].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="px-4 py-2.5 bg-navy-50 rounded-xl border border-navy-200 font-mono text-navy-700">
                      {String(v)}
                      <span className="text-[12px] text-navy-400 ml-2 font-sans">({k})</span>
                    </div>
                  ))}
              </div>
              <div className="flex flex-col items-center">
                <div className="text-[12px] text-navy-400 mb-1 font-medium">{feature.rule_type}</div>
                <div className="w-16 h-0.5 bg-brand-300 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-l-8 border-l-brand-400 border-y-4 border-y-transparent" />
                </div>
              </div>
              <div className="px-4 py-2.5 bg-brand-50 rounded-xl border border-brand-200 font-mono text-brand-700 font-semibold">
                {feature.output_column}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6">
            <h3 className="text-[16px] font-bold text-navy-800 mb-4 flex items-center gap-2">
              <Code className="w-5 h-5" />SQL Expression
            </h3>
            <pre className="bg-navy-900 text-navy-100 rounded-xl p-5 text-[14px] font-mono overflow-x-auto leading-relaxed">
              {feature.sql_expression || "N/A"}
            </pre>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6">
            <h3 className="text-[16px] font-bold text-navy-800 mb-4">Parameters</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(params).map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-navy-100 text-[14px]">
                  <span className="text-navy-500">{k}</span>
                  <span className="font-mono text-navy-800">{JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* EXPLORATION */}
      {tab === "exploration" && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-card p-6">
            <h3 className="text-[16px] font-bold text-navy-800 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />Source Column Distribution
            </h3>
            {dist ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dist.bins} margin={{ top: 5, right: 10, bottom: 30, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748B" }} angle={-30} textAnchor="end"
                    interval={dist.bins.length > 15 ? Math.floor(dist.bins.length / 8) : 0} />
                  <YAxis tick={{ fontSize: 12, fill: "#64748B" }} />
                  <Tooltip contentStyle={{ fontSize: 14, border: "1px solid #E2E8F0", borderRadius: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {dist.bins.map((_, i) => <Cell key={i} fill="#FF3621" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12 text-navy-400 text-[15px]">
                Distribution not available for this feature type
              </div>
            )}
          </div>

          <div className="bg-navy-50 rounded-2xl border border-navy-200 p-6 text-center text-[15px] text-navy-500">
            To see the full exploration of derived values, open the project workspace and run a preview.
            {feature.project && (
              <Link to={`/projects/${feature.project.project_id}`}
                className="block mt-2 text-brand-500 hover:underline font-semibold">
                Open Project: {feature.project.name}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* AUDIT TRAIL */}
      {tab === "audit" && (
        <div className="bg-white rounded-2xl shadow-card">
          {feature.logs.length === 0 ? (
            <div className="p-12 text-center text-navy-400 text-[15px]">No audit logs.</div>
          ) : (
            <div className="divide-y divide-navy-100">
              {feature.logs.map(l => {
                const actionStyle = l.action === "APPROVED" ? "bg-emerald-50 text-emerald-700" :
                  l.action === "REJECTED" ? "bg-red-50 text-red-700" :
                  l.action === "MATERIALIZED" ? "bg-blue-50 text-blue-700" :
                  "bg-navy-100 text-navy-600";
                return (
                  <div key={l.log_id} className="flex items-center gap-3 px-6 py-4">
                    <Clock className="w-4 h-4 text-navy-400 shrink-0" />
                    <span className="text-[14px] text-navy-500 w-44">{l.action_time}</span>
                    <span className={`text-[12px] px-2.5 py-1 rounded-lg font-semibold ${actionStyle}`}>{l.action}</span>
                    <span className="text-[14px] text-navy-700">by {l.actor}</span>
                    {l.details && <span className="text-[14px] text-navy-400 truncate">— {l.details}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
