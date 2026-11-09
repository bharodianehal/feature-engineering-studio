import { useState, useEffect } from "react";
import {
  getProfile, getDistribution, previewFeatures, suggestColumn,
} from "../api";
import type {
  ProfileResult, DistributionResult,
  FeatureRule, SuggestedRule,
} from "../api";
import { TRANSFORM_PREFIX, RULE_CATEGORY, VAR_CATEGORY_LABELS } from "../api";
import type { VarCategory } from "../api";
import type { TableRef } from "./ProjectWorkspace";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, Loader2, Sparkles, Check, X, Trash2,
  ChevronDown, Combine, FileText, BarChart3, Eye,
  MessageSquare, Wand2, AlertTriangle, Bot,
} from "lucide-react";

interface Props {
  table: TableRef;
  variables: FeatureRule[];
  onAdd: (v: FeatureRule) => void;
  onRemove: (id: string) => void;
}

/* ── Transform options by column type ── */

const NUMERIC_TRANSFORMS = [
  { type: "log", label: "Log Transform", desc: "ln(1+|x|) — reduce right skew" },
  { type: "log10", label: "Log10 Transform", desc: "log₁₀(1+|x|) — reduce right skew" },
  { type: "zscore", label: "Z-Score Standardize", desc: "(x−μ)/σ — center and scale" },
  { type: "minmax", label: "Min-Max Scale", desc: "Scale to [0,1] range" },
  { type: "sqrt", label: "Square Root", desc: "√|x| — moderate skew reduction" },
  { type: "square", label: "Square", desc: "x² — amplify large values" },
  { type: "centering", label: "Center (Mean)", desc: "x − mean — zero-center" },
  { type: "range_std", label: "Range Standardize", desc: "Rescale by range" },
  { type: "inverse", label: "Inverse", desc: "1/x — reciprocal" },
  { type: "inverse_sqrt", label: "Inverse Sqrt", desc: "1/√|x|" },
  { type: "inverse_square", label: "Inverse Square", desc: "1/x²" },
  { type: "bin_quantile", label: "Bin (Quantile)", desc: "Equal-frequency bins" },
  { type: "bucket_bin", label: "Bin (Equal-Width)", desc: "Fixed-width buckets" },
  { type: "impute_mean", label: "Impute Mean", desc: "Fill nulls with mean" },
  { type: "impute_median", label: "Impute Median", desc: "Fill nulls with median" },
  { type: "missing_indicator", label: "Missing Indicator", desc: "Flag null rows (0/1)" },
];

const CAT_TRANSFORMS = [
  { type: "one_hot", label: "One-Hot Encode", desc: "Dummy variables per category" },
  { type: "label_encode", label: "Label Encode", desc: "Integer mapping" },
  { type: "impute_mode", label: "Impute Mode", desc: "Fill nulls with most frequent" },
  { type: "missing_indicator", label: "Missing Indicator", desc: "Flag null rows (0/1)" },
];

const DERIVED_OPTS = [
  { type: "ratio", label: "Ratio (a / b)", fields: ["numerator", "denominator"] },
  { type: "difference", label: "Difference (a − b)", fields: ["column_a", "column_b"] },
  { type: "product", label: "Product (a × b)", fields: ["column_a", "column_b"] },
];

const ALL_TRANSFORMS = [...NUMERIC_TRANSFORMS, ...CAT_TRANSFORMS];

export default function VariablesPage({ table, variables, onAdd, onRemove }: Props) {
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [profLoading, setProfLoading] = useState(false);
  const [showDerived, setShowDerived] = useState(false);
  const [expandedVar, setExpandedVar] = useState("");

  // Add variable form
  const [addColumn, setAddColumn] = useState("");
  const [addTransform, setAddTransform] = useState("");
  const [addNotes, setAddNotes] = useState("");

  // AI suggestions (per-column)
  const [aiSuggestions, setAiSuggestions] = useState<SuggestedRule[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"ai" | "heuristic" | "">("");
  const [aiColumn, setAiColumn] = useState("");

  const { catalog, schema: sch, table: tbl } = table;

  useEffect(() => {
    setProfLoading(true);
    getProfile(catalog, sch, tbl).then(setProfile).finally(() => setProfLoading(false));
  }, [catalog, sch, tbl]);

  const numCols = profile?.columns.filter(c => c.isNumeric).map(c => c.name) || [];
  const catCols = profile?.columns.filter(c => !c.isNumeric).map(c => c.name) || [];
  const missingCols = profile?.columns.filter(c => c.nullCount > 0) || [];

  const selectedColProfile = profile?.columns.find(c => c.name === addColumn);
  const isSelectedNum = selectedColProfile?.isNumeric ?? true;
  const transformOptions = addColumn ? (isSelectedNum ? NUMERIC_TRANSFORMS : CAT_TRANSFORMS) : [];

  // Reset transform and AI when column changes
  useEffect(() => {
    setAddTransform("");
    setAiSuggestions([]);
    setAiSource("");
    setAiColumn("");
  }, [addColumn]);

  const getOutputCol = (type: string, col: string) => {
    const prefix = TRANSFORM_PREFIX[type] || "T_";
    return `${prefix}${col}`;
  };

  const existingOutputs = variables.map(v => v.outputColumn);

  const handleAddVariable = () => {
    if (!addColumn || !addTransform) return;
    const outCol = getOutputCol(addTransform, addColumn);
    if (variables.some(v => v.outputColumn === outCol)) return;
    const transformDef = ALL_TRANSFORMS.find(t => t.type === addTransform);
    const extraParams: Record<string, unknown> = {};
    if (addTransform === "bin_quantile" || addTransform === "bucket_bin") extraParams.bins = 5;
    if (addTransform === "one_hot") extraParams.drop_first = true;
    onAdd({
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: addTransform, name: transformDef?.label || addTransform,
      params: { column: addColumn, ...extraParams },
      outputColumn: outCol,
      notes: addNotes.trim() || undefined,
    });
    setAddNotes("");
    setAddTransform("");
  };

  const handleAskAI = () => {
    if (!addColumn) return;
    setAiLoading(true);
    setAiSuggestions([]);
    setAiColumn(addColumn);
    suggestColumn(catalog, sch, tbl, addColumn, existingOutputs)
      .then(r => {
        setAiSuggestions(r.suggestions);
        setAiSource(r.source);
      })
      .catch(() => setAiSuggestions([]))
      .finally(() => setAiLoading(false));
  };

  const acceptSuggestion = (sug: SuggestedRule) => {
    if (variables.some(v => v.outputColumn === sug.outputColumn)) return;
    onAdd({
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: sug.type, name: sug.name,
      params: { ...sug.params },
      outputColumn: sug.outputColumn,
      notes: sug.reason,
    });
    // Remove from suggestions list
    setAiSuggestions(prev => prev.filter(s => s.outputColumn !== sug.outputColumn));
  };

  const acceptAllSuggestions = () => {
    for (const sug of aiSuggestions) {
      if (!variables.some(v => v.outputColumn === sug.outputColumn)) {
        onAdd({
          id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: sug.type, name: sug.name,
          params: { ...sug.params },
          outputColumn: sug.outputColumn,
          notes: sug.reason,
        });
      }
    }
    setAiSuggestions([]);
  };

  const addImpute = (col: string, method: string) => {
    const outCol = getOutputCol(method, col);
    if (variables.some(v => v.outputColumn === outCol)) return;
    onAdd({
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: method, name: method === "impute_mean" ? "Impute Mean" : method === "impute_median" ? "Impute Median" : "Impute Mode",
      params: { column: col }, outputColumn: outCol,
      notes: `Auto-impute ${col} (${(profile?.columns.find(c => c.name === col)?.nullPct || 0)}% missing)`,
    });
    const mCol = `M_${col}`;
    if (!variables.some(v => v.outputColumn === mCol)) {
      onAdd({
        id: `v_${Date.now()}_m_${Math.random().toString(36).slice(2, 6)}`,
        type: "missing_indicator", name: "Missing Indicator",
        params: { column: col }, outputColumn: mCol,
        notes: `Null flag for ${col}`,
      });
    }
  };

  const updateNotes = (id: string, notes: string) => {
    const v = variables.find(vr => vr.id === id);
    if (!v) return;
    onRemove(id);
    onAdd({ ...v, notes });
  };

  // Group variables by category
  const grouped: [VarCategory, FeatureRule[]][] = (
    Object.entries(
      variables.reduce((acc, v) => {
        const cat = (RULE_CATEGORY[v.type] || "derived") as VarCategory;
        (acc[cat] = acc[cat] || []).push(v);
        return acc;
      }, {} as Record<VarCategory, FeatureRule[]>)
    ) as [VarCategory, FeatureRule[]][]
  );

  if (profLoading) return <div className="flex items-center justify-center h-64 text-navy-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Profiling table...</div>;
  if (!profile) return null;

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── Add Variable Form ── */}
      <div className="bg-white rounded-xl border border-navy-100 p-5">
        <h3 className="text-sm font-semibold text-navy-800 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-brand-500" />Add Variable
        </h3>

        {/* Row 1: Column + Ask AI */}
        <div className="flex gap-3 items-end mb-3">
          <div className="flex-1">
            <label className="block text-xs text-navy-500 font-medium mb-1">Source Column</label>
            <select value={addColumn} onChange={e => setAddColumn(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-navy-200 rounded-lg bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
              <option value="">Select column...</option>
              <optgroup label="Numeric">
                {numCols.map(c => <option key={c} value={c}>{c}</option>)}
              </optgroup>
              <optgroup label="Categorical">
                {catCols.map(c => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            </select>
          </div>
          <button onClick={handleAskAI} disabled={!addColumn || aiLoading}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-brand-300 text-brand-600 hover:bg-brand-50 disabled:opacity-40 transition-colors shrink-0">
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Ask AI
          </button>
        </div>

        {/* Column stats (when selected) */}
        {selectedColProfile && (
          <div className="bg-navy-50 rounded-lg px-4 py-2.5 mb-3 text-xs text-navy-600 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="text-navy-400">Type:</span> {selectedColProfile.type}</span>
            <span><span className="text-navy-400">Distinct:</span> {selectedColProfile.distinctCount.toLocaleString()}</span>
            {selectedColProfile.nullPct > 0 && (
              <span className="text-amber-700"><span className="text-amber-500">Missing:</span> {selectedColProfile.nullPct}%</span>
            )}
            {selectedColProfile.isNumeric && (
              <>
                <span><span className="text-navy-400">Range:</span> {selectedColProfile.min?.toLocaleString()} – {selectedColProfile.max?.toLocaleString()}</span>
                <span><span className="text-navy-400">Mean:</span> {selectedColProfile.mean?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                {selectedColProfile.skewness != null && (
                  <span className={Math.abs(selectedColProfile.skewness) > 1 ? "text-amber-700" : ""}>
                    <span className="text-navy-400">Skew:</span> {selectedColProfile.skewness?.toFixed(2)}
                  </span>
                )}
              </>
            )}
            {!selectedColProfile.isNumeric && selectedColProfile.topValues && (
              <span><span className="text-navy-400">Top:</span> {selectedColProfile.topValues.slice(0, 3).map(v => v.value).join(", ")}</span>
            )}
          </div>
        )}

        {/* AI Suggestions (inline, per-column) */}
        {(aiLoading || aiSuggestions.length > 0) && (
          <div className="bg-gradient-to-r from-brand-50 to-white border border-brand-200 rounded-lg mb-3 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-brand-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-brand-500" />
              <span className="text-sm font-medium text-brand-700">
                AI Suggestions for <span className="font-mono">{aiColumn}</span>
              </span>
              {aiSource === "ai" && <span className="text-[10px] px-1.5 py-0.5 bg-brand-100 text-brand-600 rounded ml-1">LLM</span>}
              {aiSource === "heuristic" && <span className="text-[10px] px-1.5 py-0.5 bg-navy-100 text-navy-500 rounded ml-1">Rule-based</span>}
              {aiSuggestions.length > 1 && (
                <button onClick={acceptAllSuggestions}
                  className="ml-auto px-2.5 py-1 text-xs font-medium text-white bg-brand-500 rounded hover:bg-brand-600">
                  Accept All ({aiSuggestions.length})
                </button>
              )}
            </div>
            {aiLoading ? (
              <div className="px-4 py-6 text-center text-sm text-navy-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />Analyzing column with AI...
              </div>
            ) : aiSuggestions.length === 0 ? (
              <div className="px-4 py-4 text-center text-sm text-navy-400">
                No additional suggestions. All relevant transforms already applied.
              </div>
            ) : (
              <div className="divide-y divide-brand-100">
                {aiSuggestions.map((sug, i) => {
                  const alreadyExists = variables.some(v => v.outputColumn === sug.outputColumn);
                  return (
                    <div key={i} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-navy-800">{sug.name}</span>
                          <span className="text-xs font-mono text-navy-500 px-1.5 py-0.5 bg-navy-50 rounded">{sug.outputColumn}</span>
                        </div>
                        <div className="text-xs text-navy-600 mt-1">{sug.reason}</div>
                      </div>
                      <button onClick={() => acceptSuggestion(sug)} disabled={alreadyExists}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border shrink-0 transition-colors ${
                          alreadyExists
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600"
                            : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                        }`}>
                        {alreadyExists ? <><Check className="w-3.5 h-3.5 inline mr-0.5" />Added</> : <><Plus className="w-3.5 h-3.5 inline mr-0.5" />Accept</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Row 2: Transform dropdown + Add */}
        {addColumn && (
          <>
            <div className="flex gap-3 items-end mb-3">
              <div className="flex-1">
                <label className="block text-xs text-navy-500 font-medium mb-1">Transformation</label>
                <select value={addTransform} onChange={e => setAddTransform(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-navy-200 rounded-lg bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                  <option value="">Select transform...</option>
                  {transformOptions.map(t => {
                    const outCol = getOutputCol(t.type, addColumn);
                    const exists = variables.some(v => v.outputColumn === outCol);
                    return <option key={t.type} value={t.type} disabled={exists}>{t.label}{exists ? " ✓" : ""} — {t.desc}</option>;
                  })}
                </select>
              </div>
              <button onClick={handleAddVariable} disabled={!addTransform}
                className="px-4 py-2.5 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 disabled:opacity-40 transition-colors shrink-0">
                <Plus className="w-4 h-4 inline mr-1" />Add
              </button>
            </div>

            {/* Output preview + notes */}
            {addTransform && (
              <div className="space-y-2">
                <div className="text-xs text-navy-500 flex items-center gap-2">
                  Output: <span className="font-mono px-1.5 py-0.5 bg-navy-50 rounded text-navy-700">{getOutputCol(addTransform, addColumn)}</span>
                  <span>— {ALL_TRANSFORMS.find(t => t.type === addTransform)?.desc}</span>
                </div>
                <div>
                  <label className="block text-xs text-navy-500 font-medium mb-1">
                    <MessageSquare className="w-3 h-3 inline mr-1" />Why this transformation? (optional)
                  </label>
                  <input type="text" value={addNotes} onChange={e => setAddNotes(e.target.value)}
                    placeholder="e.g., Log transform to reduce right skew in income distribution"
                    className="w-full px-3 py-2 text-sm border border-navy-200 rounded-lg text-navy-800 focus:outline-none focus:ring-1 focus:ring-brand-300" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Combine Columns ── */}
      <button onClick={() => setShowDerived(!showDerived)}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
          showDerived ? "border-brand-300 bg-brand-50 text-brand-600" : "border-navy-200 text-navy-600 hover:bg-navy-50"
        }`}>
        <Combine className="w-4 h-4" />Combine Columns
      </button>

      {showDerived && <DerivedPanel numCols={numCols} onAdd={onAdd} existing={variables} />}

      {/* ── Missing Values Alert ── */}
      {missingCols.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800">{missingCols.length} column(s) have missing values</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missingCols.map(c => {
              const method = c.isNumeric ? "impute_mean" : "impute_mode";
              const outCol = getOutputCol(method, c.name);
              const exists = variables.some(v => v.outputColumn === outCol);
              return (
                <button key={c.name} onClick={() => !exists && addImpute(c.name, method)} disabled={exists}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                    exists ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-white border-amber-300 text-amber-700 hover:bg-amber-100"
                  }`}>
                  {exists ? <Check className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
                  {c.name} <span className="text-[10px] opacity-70">{c.nullPct}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Created Variables ── */}
      {variables.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-navy-800 mb-3">
            Created Variables ({variables.length})
          </h3>
          <div className="space-y-2">
            {grouped.map(([cat, vars]) => (
              <div key={cat}>
                <div className="text-[11px] font-semibold text-navy-400 uppercase tracking-wider mb-1.5">
                  {VAR_CATEGORY_LABELS[cat]} ({vars.length})
                </div>
                {vars.map(v => (
                  <VariableCard key={v.id} variable={v} table={table}
                    expanded={expandedVar === v.id}
                    onToggle={() => setExpandedVar(expandedVar === v.id ? "" : v.id)}
                    onRemove={() => onRemove(v.id)}
                    onUpdateNotes={(notes) => updateNotes(v.id, notes)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Variable Card with chart/table review ── */

function VariableCard({ variable, table, expanded, onToggle, onRemove, onUpdateNotes }: {
  variable: FeatureRule;
  table: TableRef;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [dist, setDist] = useState<DistributionResult | null>(null);
  const [distLoading, setDistLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, string>[] } | null>(null);
  const [prevLoading, setPrevLoading] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState(variable.notes || "");

  const sourceCol = (variable.params as Record<string, unknown>).column as string || "";
  const category = RULE_CATEGORY[variable.type] || "derived";
  const transformDef = ALL_TRANSFORMS.find(t => t.type === variable.type);

  useEffect(() => {
    if (!expanded) return;
    if (previewData) return;
    setPrevLoading(true);
    previewFeatures(table.catalog, table.schema, table.table, [variable])
      .then(setPreviewData).finally(() => setPrevLoading(false));
    if (sourceCol) {
      setDistLoading(true);
      getDistribution(table.catalog, table.schema, table.table, sourceCol)
        .then(setDist).finally(() => setDistLoading(false));
    }
  }, [expanded, table, variable, sourceCol, previewData]);

  const saveNotes = () => { onUpdateNotes(noteDraft); setEditingNotes(false); };

  const catColor = category === "transform" ? "bg-blue-100 text-blue-700"
    : category === "binning" ? "bg-indigo-100 text-indigo-700"
    : category === "encoding" ? "bg-purple-100 text-purple-700"
    : category === "imputation" ? "bg-amber-100 text-amber-700"
    : "bg-teal-100 text-teal-700";

  return (
    <div className="bg-white rounded-xl border border-navy-100 mb-2 overflow-hidden transition-all">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50/50 cursor-pointer" onClick={onToggle}>
        <ChevronDown className={`w-4 h-4 text-navy-400 transition-transform shrink-0 ${expanded ? "" : "-rotate-90"}`} />
        <span className="text-sm font-mono font-semibold text-navy-800 min-w-[160px]">{variable.outputColumn}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${catColor}`}>
          {VAR_CATEGORY_LABELS[category as VarCategory]}
        </span>
        <span className="text-xs text-navy-500">{variable.name}</span>
        {sourceCol && <span className="text-xs text-navy-400 font-mono ml-auto">← {sourceCol}</span>}
        {variable.notes && <FileText className="w-3.5 h-3.5 text-navy-400 shrink-0" />}
        <button onClick={e => { e.stopPropagation(); onRemove(); }}
          className="text-navy-400 hover:text-red-500 shrink-0 p-1 rounded hover:bg-red-50 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {!expanded && variable.notes && (
        <div className="px-4 pb-2.5 -mt-1 pl-11">
          <span className="text-xs text-navy-500 italic">{variable.notes}</span>
        </div>
      )}

      {expanded && (
        <div className="border-t border-navy-100 px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-navy-400 text-xs block mb-0.5">Transformation</span>
              <span className="text-navy-800 font-medium">{transformDef?.label || variable.type}</span>
              <span className="text-xs text-navy-500 block">{transformDef?.desc}</span>
            </div>
            <div>
              <span className="text-navy-400 text-xs block mb-0.5">Source Column</span>
              <span className="font-mono text-navy-800">{sourceCol || "—"}</span>
            </div>
            <div>
              <span className="text-navy-400 text-xs block mb-0.5">Output Column</span>
              <span className="font-mono text-brand-700 font-medium">{variable.outputColumn}</span>
            </div>
          </div>

          {Object.keys(variable.params).length > 1 && (
            <div className="bg-navy-50 rounded-lg p-3">
              <span className="text-xs font-medium text-navy-500 block mb-1.5">Parameters</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(variable.params).filter(([k]) => k !== "column").map(([k, v]) => (
                  <span key={k} className="text-xs">
                    <span className="text-navy-500">{k}: </span>
                    <span className="font-mono text-navy-800">{JSON.stringify(v)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Documentation */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-navy-400" />
              <span className="text-xs font-medium text-navy-500">Documentation</span>
              {!editingNotes && (
                <button onClick={() => { setNoteDraft(variable.notes || ""); setEditingNotes(true); }}
                  className="text-xs text-brand-500 hover:text-brand-600 font-medium ml-auto">
                  {variable.notes ? "Edit" : "Add notes"}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex gap-2">
                <input type="text" value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                  placeholder="Why this transformation? Business rationale, statistical justification..."
                  className="flex-1 px-3 py-2 text-sm border border-navy-200 rounded-lg text-navy-800 focus:outline-none focus:ring-1 focus:ring-brand-300"
                  autoFocus onKeyDown={e => { if (e.key === "Enter") saveNotes(); if (e.key === "Escape") setEditingNotes(false); }} />
                <button onClick={saveNotes} className="px-3 py-2 text-xs font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600">Save</button>
                <button onClick={() => setEditingNotes(false)} className="px-3 py-2 text-xs font-medium text-navy-600 border border-navy-200 rounded-lg hover:bg-navy-50">Cancel</button>
              </div>
            ) : variable.notes ? (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-sm text-navy-700">{variable.notes}</div>
            ) : (
              <div className="text-xs text-navy-400 italic">No documentation yet</div>
            )}
          </div>

          {/* Distribution chart */}
          {sourceCol && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-3.5 h-3.5 text-navy-400" />
                <span className="text-xs font-medium text-navy-500">Source Distribution ({sourceCol})</span>
              </div>
              {distLoading ? (
                <div className="flex items-center justify-center h-32 text-navy-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Loading chart...</div>
              ) : dist ? (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={dist.bins} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6B7280" }} angle={-30} textAnchor="end"
                      interval={dist.bins.length > 12 ? Math.floor(dist.bins.length / 6) : 0} />
                    <YAxis tick={{ fontSize: 10, fill: "#6B7280" }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #D1D5DB" }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {dist.bins.map((_, i) => <Cell key={i} fill="#FF3621" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-center py-6 text-sm text-navy-400">Distribution not available</div>}
            </div>
          )}

          {/* Preview table */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-3.5 h-3.5 text-navy-400" />
              <span className="text-xs font-medium text-navy-500">Data Preview</span>
            </div>
            {prevLoading ? (
              <div className="flex items-center justify-center h-24 text-navy-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Running preview...</div>
            ) : previewData ? (
              <div className="overflow-auto max-h-[200px] rounded-lg border border-navy-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-navy-50">
                      {previewData.columns.map(c => (
                        <th key={c} className={`px-3 py-1.5 text-left font-medium whitespace-nowrap border-b border-navy-100 text-xs ${
                          c === variable.outputColumn ? "text-brand-600 bg-brand-50" : "text-navy-600"
                        }`}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-b border-navy-50 hover:bg-navy-50/50">
                        {previewData.columns.map(c => (
                          <td key={c} className={`px-3 py-1 whitespace-nowrap max-w-[120px] truncate text-xs ${
                            c === variable.outputColumn ? "text-brand-700 font-mono font-medium bg-brand-50/30" : "text-navy-700"
                          }`}>{r[c] ?? "null"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-center py-6 text-sm text-navy-400">Preview not available</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Derived (Combine) Panel ── */

function DerivedPanel({ numCols, onAdd, existing }: {
  numCols: string[]; onAdd: (v: FeatureRule) => void; existing: FeatureRule[];
}) {
  const [method, setMethod] = useState("ratio");
  const [params, setParams] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const info = DERIVED_OPTS.find(d => d.type === method)!;

  const handleAdd = () => {
    const a = params[info.fields[0]] || "";
    const b = params[info.fields[1]] || "";
    if (!a || !b) return;
    const prefix = TRANSFORM_PREFIX[method] || "D_";
    const outCol = `${prefix}${a}_${b}`;
    if (existing.some(v => v.outputColumn === outCol)) return;
    onAdd({
      id: `v_${Date.now()}`, type: method,
      name: info.label.split(" (")[0],
      params: { ...params }, outputColumn: outCol,
      notes: notes.trim() || undefined,
    });
    setParams({}); setNotes("");
  };

  return (
    <div className="bg-white rounded-xl border border-navy-200 p-4 space-y-3">
      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs text-navy-500 font-medium">Operation</label>
          <select value={method} onChange={e => { setMethod(e.target.value); setParams({}); }}
            className="w-full mt-1 text-sm px-2 py-2 border border-navy-200 rounded bg-white text-navy-800">
            {DERIVED_OPTS.map(d => <option key={d.type} value={d.type}>{d.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-navy-500 font-medium">{info.fields[0].replace("_", " ")}</label>
          <select value={params[info.fields[0]] || ""} onChange={e => setParams({ ...params, [info.fields[0]]: e.target.value })}
            className="w-full mt-1 text-sm px-2 py-2 border border-navy-200 rounded bg-white text-navy-800">
            <option value="">Select...</option>
            {numCols.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-navy-500 font-medium">{info.fields[1].replace("_", " ")}</label>
          <select value={params[info.fields[1]] || ""} onChange={e => setParams({ ...params, [info.fields[1]]: e.target.value })}
            className="w-full mt-1 text-sm px-2 py-2 border border-navy-200 rounded bg-white text-navy-800">
            <option value="">Select...</option>
            {numCols.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={handleAdd} disabled={!params[info.fields[0]] || !params[info.fields[1]]}
          className="px-3 py-2 text-sm font-medium text-white bg-brand-500 rounded hover:bg-brand-600 disabled:opacity-40">
          <Plus className="w-3.5 h-3.5 inline mr-1" />Add
        </button>
      </div>
      <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Why this derived variable? (optional)"
        className="w-full px-3 py-2 text-sm border border-navy-200 rounded-lg text-navy-800 focus:outline-none focus:ring-1 focus:ring-brand-300" />
    </div>
  );
}
