import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getInventory, getProjects } from "../api";
import type { InventoryItem, Project } from "../api";
import { RULE_CATEGORY } from "../api";
import {
  Loader2, Zap, Search, ChevronRight, FolderOpen,
} from "lucide-react";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_APPROVAL: { bg: "bg-amber-50", text: "text-amber-700", label: "Pending" },
  APPROVED: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" },
  REJECTED: { bg: "bg-red-50", text: "text-red-700", label: "Rejected" },
  MATERIALIZED: { bg: "bg-blue-50", text: "text-blue-700", label: "Materialized" },
};

const CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform", binning: "Binning", encoding: "Encoding",
  imputation: "Imputation", derived: "Derived",
};

export default function FeatureInventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([getInventory(), getProjects()])
      .then(([inv, projs]) => {
        setItems(inv);
        const projMap: Record<string, Project> = {};
        projs.forEach(p => { projMap[p.project_id] = p; });
        setProjects(projMap);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(item => {
    if (search && !item.output_column.toLowerCase().includes(search.toLowerCase()) &&
        !item.rule_type.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (typeFilter && (RULE_CATEGORY[item.rule_type] || "derived") !== typeFilter) return false;
    return true;
  });

  const statusCounts = items.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-navy-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading feature inventory...
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-900 tracking-tight">Feature Inventory</h1>
            <p className="text-[15px] text-navy-500 mt-0.5">
              All features across all projects — {items.length} total
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {Object.entries(statusCounts).map(([status, count]) => {
            const st = STATUS_STYLES[status];
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
          {Object.entries(STATUS_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl bg-white text-navy-800">
          <option value="">All Types</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Feature table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-14 text-center">
          <div className="w-14 h-14 rounded-2xl bg-navy-100 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-navy-400" />
          </div>
          <div className="text-lg font-semibold text-navy-800 mb-2">
            {items.length === 0 ? "No features yet" : "No features match your filters"}
          </div>
          <div className="text-[15px] text-navy-500">
            {items.length === 0 ? "Create a project and start engineering features" : "Try adjusting your search or filters"}
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
                <th className="px-5 py-3.5 text-left font-semibold">Project</th>
                <th className="px-5 py-3.5 text-left font-semibold">Status</th>
                <th className="px-5 py-3.5 text-left font-semibold">Created</th>
                <th className="px-5 py-3.5 text-left font-semibold w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const st = STATUS_STYLES[item.status] || { bg: "bg-navy-100", text: "text-navy-600", label: item.status };
                const category = RULE_CATEGORY[item.rule_type] || "derived";
                const proj = projects[item.project_id];
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
                      <span className="text-navy-400 ml-2">{item.rule_type}</span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-navy-600 text-[13px]">
                      {item.source_catalog}.{item.source_schema}.{item.source_table}
                    </td>
                    <td className="px-5 py-3.5">
                      {proj ? (
                        <span className="flex items-center gap-1.5 text-navy-600">
                          <FolderOpen className="w-3.5 h-3.5 text-navy-400" />
                          {proj.name}
                        </span>
                      ) : (
                        <span className="text-navy-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[12px] px-2.5 py-1 rounded-lg font-semibold ${st.bg} ${st.text}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-navy-500 text-[13px]">
                      {item.created_by?.split("@")[0]}<br />{item.created_at?.split(" ")[0]}
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
