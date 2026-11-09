import { useState, useRef, useEffect, useCallback } from "react";
import {
  getTables, getTableInfo, runSegmentation,
  getKpiLift, getContext, getActions, getPersona, compareSegments,
} from "../api";
import type {
  TableInfo, SegmentResult, ClusterSummary,
  KpiLiftResult, ContextResult, ActionsResult,
  PersonaResult, CompareResult, DefiningFeature, ActionItem, ClusterLift,
} from "../api";
import Plot from "react-plotly.js";
import { Brain, Loader2, Send, User, Zap, TrendingUp, TrendingDown, ArrowUpRight, Sparkles } from "lucide-react";

// -- Constants --

const CLUSTER_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#3b82f6", "#84cc16",
];

// -- Types --

type RichContentType =
  | "table_list" | "table_info" | "scatter_plot" | "cluster_cards"
  | "kpi_lift_chart" | "context_card" | "persona_card" | "action_cards"
  | "compare_card" | "quick_picks" | "column_info";

interface RichContent {
  type: RichContentType;
  data: any;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  richContent?: RichContent;
  isError?: boolean;
}

interface ChatState {
  catalog: string;
  schema: string;
  table: string;
  tableInfo: TableInfo | null;
  segmentResult: SegmentResult | null;
  contextCache: Record<number, ContextResult>;
  kpiLiftCache: Record<string, KpiLiftResult>;
  pendingAction: string | null;
}

// -- Intent Detection --

function detectIntent(input: string, state: ChatState): { intent: string; params: Record<string, any> } {
  const lower = input.toLowerCase().trim();

  if (state.pendingAction === "awaiting_k" && /^\d+$/.test(lower)) {
    return { intent: "set_k", params: { k: parseInt(lower, 10) } };
  }

  if (/(?:show|list)\s+tables|tables\s+in\s+/i.test(lower)) {
    const match = lower.match(/(?:tables?\s+in\s+)(\w+)\.(\w+)/);
    if (match) return { intent: "show_tables", params: { catalog: match[1], schema: match[2] } };
    return { intent: "show_tables", params: {} };
  }

  const useMatch = lower.match(/(?:use|select|analyze)\s+(\S+)/);
  if (useMatch) return { intent: "select_table", params: { table: useMatch[1] } };

  if (/(?:run|do|start|execute)\s+(?:.*?)(?:clustering|segmentation|segment)/i.test(lower) || /\bkmeans\b|\bk-means\b/i.test(lower)) {
    const kMatch = lower.match(/k\s*=\s*(\d+)|with\s+(\d+)\s+cluster/);
    if (kMatch) return { intent: "run_clustering", params: { algorithm: "kmeans", k: parseInt(kMatch[1] || kMatch[2], 10) } };
    return { intent: "run_clustering", params: { algorithm: "kmeans" } };
  }
  if (/\bdbscan\b/i.test(lower)) {
    return { intent: "run_clustering", params: { algorithm: "dbscan" } };
  }
  if (/\bcluster\b|\bsegment\b/i.test(lower) && !/tell|about|describe|context|compare|persona|who|action|strateg/i.test(lower)) {
    return { intent: "run_clustering", params: { algorithm: "kmeans" } };
  }

  if (/kpi\s*lift|kpi\s*lens|show\s+lift|how\s+does\s+\S+\s+distribut/i.test(lower)) {
    const colMatch = lower.match(/(?:lift\s+for|lens\s+for|how\s+does)\s+(\w+)/);
    return { intent: "kpi_lift", params: { column: colMatch ? colMatch[1] : null } };
  }

  if (/tell\s+me\s+about\s+cluster|describe\s+cluster|context\s+for\s+cluster|who\s+is\s+cluster/i.test(lower)) {
    const cMatch = lower.match(/cluster\s+(\d+)/);
    return { intent: "context", params: { cluster_id: cMatch ? parseInt(cMatch[1], 10) : null } };
  }

  if (/persona\s+for\s+cluster|who\s+are\s+cluster\s+\d+\s+customer/i.test(lower)) {
    const cMatch = lower.match(/cluster\s+(\d+)/);
    return { intent: "persona", params: { cluster_id: cMatch ? parseInt(cMatch[1], 10) : null } };
  }

  if (/compare\s+cluster|difference\s+between/i.test(lower)) {
    const nums = [...lower.matchAll(/(\d+)/g)].map(m => parseInt(m[1], 10));
    return { intent: "compare", params: { a: nums[0] ?? null, b: nums[1] ?? null } };
  }

  if (/actions?\s+for|strategies?\s+for|what\s+should\s+i\s+do|recommendations?\s+for/i.test(lower)) {
    const cMatch = lower.match(/cluster\s+(\d+)/);
    return { intent: "actions", params: { cluster_id: cMatch ? parseInt(cMatch[1], 10) : null } };
  }

  return { intent: "help", params: {} };
}

// -- Main Component --

export default function SegmentChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chatStateRef = useRef<ChatState>({
    catalog: "customer_segmentation",
    schema: "banking",
    table: "",
    tableInfo: null,
    segmentResult: null,
    contextCache: {},
    kpiLiftCache: {},
    pendingAction: null,
  });

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, loading, scrollToBottom]);

  const addMessages = useCallback((...msgs: ChatMessage[]) => {
    setMessages(prev => [...prev, ...msgs]);
  }, []);

  const sendAsUser = useCallback((text: string) => {
    setInput("");
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setTimeout(() => processIntent(text), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getSuggestions = useCallback((): string[] => {
    const s = chatStateRef.current;
    if (!s.table) {
      return ["Show tables in customer_segmentation.banking"];
    }
    if (!s.segmentResult) {
      return ["Run K-Means clustering", "Run DBSCAN clustering"];
    }
    const kpiCols = s.tableInfo?.columns
      .filter(c => ["int", "long", "float", "double", "decimal", "bigint"].some(t => c.type.toLowerCase().includes(t)))
      .map(c => c.name) ?? [];
    const firstKpi = kpiCols[0] || "balance";
    const nClusters = s.segmentResult.n_clusters;
    const suggestions: string[] = [];
    suggestions.push(`Show KPI lift for ${firstKpi}`);
    if (nClusters > 0) suggestions.push("Tell me about cluster 0");
    if (nClusters > 1) suggestions.push("Compare cluster 0 and 1");
    if (nClusters > 2) suggestions.push("Generate persona for cluster 2");
    return suggestions;
  }, []);

  const processIntent = useCallback(async (text: string) => {
    const state = chatStateRef.current;
    const { intent, params } = detectIntent(text, state);
    setLoading(true);

    try {
      switch (intent) {
        case "show_tables": {
          const cat = params.catalog || state.catalog;
          const sch = params.schema || state.schema;
          if (!cat || !sch) {
            addMessages({ role: "assistant", content: "Which catalog and schema should I look in? Try: \"Show tables in customer_segmentation.banking\"" });
            break;
          }
          chatStateRef.current = { ...chatStateRef.current, catalog: cat, schema: sch };
          const tables = await getTables(cat, sch);
          addMessages({
            role: "assistant",
            content: `Found ${tables.length} table${tables.length !== 1 ? "s" : ""} in **${cat}.${sch}**:`,
            richContent: { type: "table_list", data: tables },
          });
          break;
        }

        case "select_table": {
          const tbl = params.table;
          const cat = state.catalog;
          const sch = state.schema;
          if (!cat || !sch) {
            addMessages({ role: "assistant", content: "Please show tables first so I know which catalog and schema to use." });
            break;
          }
          chatStateRef.current = { ...chatStateRef.current, table: tbl, segmentResult: null, contextCache: {}, kpiLiftCache: {} };
          const info = await getTableInfo(cat, sch, tbl);
          chatStateRef.current.tableInfo = info;
          const numericCount = info.columns.filter(c => ["int", "long", "float", "double", "decimal", "bigint", "short", "smallint", "tinyint"].some(t => c.type.toLowerCase().includes(t))).length;
          const catCount = info.columns.length - numericCount;
          addMessages({
            role: "assistant",
            content: `Selected **${tbl}**. ${info.rowCount.toLocaleString()} rows, ${info.columns.length} columns (${numericCount} numeric, ${catCount} categorical). Ready for clustering.`,
            richContent: { type: "column_info", data: info },
          });
          break;
        }

        case "run_clustering": {
          if (!state.table) {
            addMessages({ role: "assistant", content: "Please select a table first. Try: \"Show tables in customer_segmentation.banking\"" });
            break;
          }
          const algo = params.algorithm || "kmeans";
          if (algo === "kmeans" && !params.k) {
            chatStateRef.current.pendingAction = "awaiting_k";
            addMessages({
              role: "assistant",
              content: "How many clusters (K)? I'd recommend 3-8 for this dataset size.",
              richContent: { type: "quick_picks", data: [3, 5, 7, 10] },
            });
            break;
          }
          chatStateRef.current.pendingAction = null;
          const k = params.k || 5;
          addMessages({ role: "assistant", content: `Running ${algo === "kmeans" ? "K-Means" : "DBSCAN"} with ${algo === "kmeans" ? `K=${k}` : "auto-detected clusters"}...` });
          const numericFeatures = state.tableInfo?.columns
            .filter(c => ["int", "long", "float", "double", "decimal", "bigint", "short", "smallint", "tinyint"].some(t => c.type.toLowerCase().includes(t)))
            .map(c => c.name) ?? [];
          const result = await runSegmentation({
            catalog: state.catalog,
            schema_name: state.schema,
            table: state.table,
            algorithm: algo,
            k: algo === "kmeans" ? k : undefined,
            features: numericFeatures.length > 0 ? numericFeatures : undefined,
          });
          chatStateRef.current = { ...chatStateRef.current, segmentResult: result, contextCache: {}, kpiLiftCache: {} };
          addMessages({
            role: "assistant",
            content: `Clustering complete! Found ${result.n_clusters} clusters with silhouette score ${result.silhouette_score.toFixed(3)}.`,
            richContent: { type: "scatter_plot", data: result },
          }, {
            role: "assistant",
            content: "",
            richContent: { type: "cluster_cards", data: result.clusters },
          });
          break;
        }

        case "set_k": {
          chatStateRef.current.pendingAction = null;
          const kVal = params.k;
          if (!state.table) {
            addMessages({ role: "assistant", content: "Please select a table first." });
            break;
          }
          addMessages({ role: "assistant", content: `Running K-Means with K=${kVal}...` });
          const numFeats = state.tableInfo?.columns
            .filter(c => ["int", "long", "float", "double", "decimal", "bigint", "short", "smallint", "tinyint"].some(t => c.type.toLowerCase().includes(t)))
            .map(c => c.name) ?? [];
          const res = await runSegmentation({
            catalog: state.catalog,
            schema_name: state.schema,
            table: state.table,
            algorithm: "kmeans",
            k: kVal,
            features: numFeats.length > 0 ? numFeats : undefined,
          });
          chatStateRef.current = { ...chatStateRef.current, segmentResult: res, contextCache: {}, kpiLiftCache: {} };
          addMessages({
            role: "assistant",
            content: `Clustering complete! Found ${res.n_clusters} clusters with silhouette score ${res.silhouette_score.toFixed(3)}.`,
            richContent: { type: "scatter_plot", data: res },
          }, {
            role: "assistant",
            content: "",
            richContent: { type: "cluster_cards", data: res.clusters },
          });
          break;
        }

        case "kpi_lift": {
          if (!state.segmentResult) {
            addMessages({ role: "assistant", content: "Please run clustering first before viewing KPI lift." });
            break;
          }
          let column = params.column;
          if (!column) {
            const numCols = state.tableInfo?.columns
              .filter(c => ["int", "long", "float", "double", "decimal", "bigint"].some(t => c.type.toLowerCase().includes(t)))
              .map(c => c.name) ?? [];
            if (numCols.length > 0) {
              column = numCols[0];
            } else {
              addMessages({ role: "assistant", content: "Which column should I compute lift for?" });
              break;
            }
          }
          const liftRes = await getKpiLift({
            catalog: state.catalog,
            schema_name: state.schema,
            table: state.table,
            kpi_column: column,
            cluster_assignments: state.segmentResult.points.map(p => p.cluster),
          });
          chatStateRef.current.kpiLiftCache[column] = liftRes;
          addMessages({
            role: "assistant",
            content: `KPI Lift for **${column}** (global mean: ${formatNumber(liftRes.global_mean)}):`,
            richContent: { type: "kpi_lift_chart", data: liftRes },
          });
          break;
        }

        case "context": {
          if (!state.segmentResult) {
            addMessages({ role: "assistant", content: "Please run clustering first." });
            break;
          }
          const cid = params.cluster_id;
          if (cid === null || cid === undefined) {
            addMessages({ role: "assistant", content: "Which cluster? Try: \"Tell me about cluster 0\"" });
            break;
          }
          const cluster = state.segmentResult.clusters.find(c => c.cluster_id === cid);
          if (!cluster) {
            addMessages({ role: "assistant", content: `Cluster ${cid} not found. Valid clusters: ${state.segmentResult.clusters.map(c => c.cluster_id).join(", ")}` });
            break;
          }
          const ctxRes = await getContext({
            cluster_id: cid,
            feature_means: cluster.feature_means,
            all_clusters: state.segmentResult.clusters,
            table_name: `${state.catalog}.${state.schema}.${state.table}`,
          });
          chatStateRef.current.contextCache[cid] = ctxRes;
          addMessages({
            role: "assistant",
            content: "",
            richContent: { type: "context_card", data: ctxRes },
          });
          break;
        }

        case "persona": {
          if (!state.segmentResult) {
            addMessages({ role: "assistant", content: "Please run clustering first." });
            break;
          }
          const pid = params.cluster_id;
          if (pid === null || pid === undefined) {
            addMessages({ role: "assistant", content: "Which cluster? Try: \"Persona for cluster 0\"" });
            break;
          }
          const pCluster = state.segmentResult.clusters.find(c => c.cluster_id === pid);
          if (!pCluster) {
            addMessages({ role: "assistant", content: `Cluster ${pid} not found.` });
            break;
          }
          const personaRes = await getPersona({
            cluster_id: pid,
            feature_means: pCluster.feature_means,
            size: pCluster.size,
            percentage: pCluster.percentage,
            table_name: `${state.catalog}.${state.schema}.${state.table}`,
          });
          addMessages({
            role: "assistant",
            content: "",
            richContent: { type: "persona_card", data: personaRes },
          });
          break;
        }

        case "compare": {
          if (!state.segmentResult) {
            addMessages({ role: "assistant", content: "Please run clustering first." });
            break;
          }
          const a = params.a;
          const b = params.b;
          if (a === null || b === null || a === undefined || b === undefined) {
            addMessages({ role: "assistant", content: "Which two clusters? Try: \"Compare cluster 0 and 1\"" });
            break;
          }
          const cmpRes = await compareSegments({
            cluster_a: a,
            cluster_b: b,
            clusters: state.segmentResult.clusters,
            table_name: `${state.catalog}.${state.schema}.${state.table}`,
          });
          addMessages({
            role: "assistant",
            content: "",
            richContent: { type: "compare_card", data: cmpRes },
          });
          break;
        }

        case "actions": {
          if (!state.segmentResult) {
            addMessages({ role: "assistant", content: "Please run clustering first." });
            break;
          }
          let aid = params.cluster_id;
          if (aid === null || aid === undefined) {
            aid = state.segmentResult.clusters[0]?.cluster_id ?? 0;
          }
          const aCluster = state.segmentResult.clusters.find(c => c.cluster_id === aid);
          if (!aCluster) {
            addMessages({ role: "assistant", content: `Cluster ${aid} not found.` });
            break;
          }
          const actRes = await getActions({
            cluster_id: aid,
            feature_means: aCluster.feature_means,
            table_name: `${state.catalog}.${state.schema}.${state.table}`,
          });
          addMessages({
            role: "assistant",
            content: `Recommended actions for Cluster ${aid}:`,
            richContent: { type: "action_cards", data: actRes },
          });
          break;
        }

        case "help":
        default: {
          const s = chatStateRef.current;
          let helpText = "Here are some things you can try:\n";
          if (!s.table) {
            helpText += '\n- "Show tables in customer_segmentation.banking"\n- "Use <table_name>"';
          } else if (!s.segmentResult) {
            helpText += `\nYou have **${s.table}** selected.\n- "Run K-Means clustering"\n- "Run DBSCAN clustering"`;
          } else {
            helpText += `\nYou have ${s.segmentResult.n_clusters} clusters.\n- "Show KPI lift for balance"\n- "Tell me about cluster 0"\n- "Compare cluster 0 and 1"\n- "Generate persona for cluster 2"\n- "Actions for cluster 0"`;
          }
          addMessages({ role: "assistant", content: helpText });
          break;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Something went wrong";
      addMessages({ role: "assistant", content: errMsg, isError: true });
    } finally {
      setLoading(false);
    }
  }, [addMessages]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    sendAsUser(trimmed);
  }, [input, loading, sendAsUser]);

  const suggestions = getSuggestions();

  return (
    <div className="flex flex-col h-full bg-navy-50">
      {/* Header */}
      <div className="border-b border-navy-200 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-navy-900 tracking-tight">Segment Genie</h1>
            <p className="text-[13px] text-navy-500 font-medium">AI-powered segmentation for marketing analysts</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-5">
        {messages.length === 0 && <WelcomeMessage onSuggestion={sendAsUser} />}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} onQuickPick={sendAsUser} />
        ))}
        {loading && <LoadingBubble />}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom area */}
      <div className="border-t border-navy-200 bg-white px-6 py-4">
        {/* Suggestion chips */}
        {!loading && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => sendAsUser(s)}
                className="border border-accent-200 text-accent-600 bg-accent-50 rounded-xl px-4 py-1.5 text-[13px] font-medium hover:bg-accent-100 transition-all duration-200">
                {s}
              </button>
            ))}
          </div>
        )}
        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your segments..."
            className="flex-1 px-5 py-3 rounded-xl border border-navy-200 text-[15px] focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent bg-navy-50 placeholder:text-navy-400"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-xl bg-accent-500 text-white text-[14px] font-semibold hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 shadow-sm">
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// -- Sub-components --

function WelcomeMessage({ onSuggestion }: { onSuggestion: (s: string) => void }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-accent-500/20">
        <Sparkles className="w-8 h-8 text-white" />
      </div>
      <h2 className="text-2xl font-bold text-navy-900 mb-3 tracking-tight">Segment Genie</h2>
      <p className="text-[15px] text-navy-500 mb-8 leading-relaxed">
        I help marketing analysts discover and understand customer segments. Here's what I can do:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto text-left mb-10">
        {[
          "Select a data table to analyze",
          "Run K-Means or DBSCAN clustering",
          "Show KPI lift across segments",
          "Generate AI personas and strategies",
          "Compare segments side by side",
          "Get recommended marketing actions",
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 text-[14px] text-navy-600">
            <div className="w-2 h-2 rounded-full bg-accent-400 mt-1.5 shrink-0" />
            {item}
          </div>
        ))}
      </div>
      <p className="text-[15px] text-navy-500 mb-5">Let's start -- which table would you like to analyze?</p>
      <button onClick={() => onSuggestion("Show tables in customer_segmentation.banking")}
        className="border border-accent-200 text-accent-600 bg-accent-50 rounded-xl px-5 py-2.5 text-[14px] font-semibold hover:bg-accent-100 transition-all duration-200">
        Show tables in customer_segmentation.banking
      </button>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex items-start gap-3 max-w-3xl">
      <div className="w-8 h-8 rounded-xl bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-4 h-4 text-accent-600" />
      </div>
      <div className="bg-white border border-navy-200 rounded-2xl rounded-bl-md px-5 py-3.5 shadow-card">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-navy-300 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-navy-300 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 rounded-full bg-navy-300 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, onQuickPick }: { message: ChatMessage; onQuickPick: (s: string) => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-accent-500 text-white rounded-2xl rounded-br-md px-5 py-3 max-w-md text-[15px] shadow-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 max-w-3xl">
      <div className="w-8 h-8 rounded-xl bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-4 h-4 text-accent-600" />
      </div>
      <div className="flex-1 space-y-2">
        {message.content && (
          <div className={`rounded-2xl rounded-bl-md px-5 py-3.5 text-[15px] leading-relaxed shadow-card ${
            message.isError
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-white border border-navy-200 text-navy-800"
          }`}>
            <MarkdownLite text={message.content} />
          </div>
        )}
        {message.richContent && (
          <RichContentRenderer richContent={message.richContent} onQuickPick={onQuickPick} />
        )}
      </div>
    </div>
  );
}

function MarkdownLite({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// -- Rich Content Renderer --

function RichContentRenderer({ richContent, onQuickPick }: { richContent: RichContent; onQuickPick: (s: string) => void }) {
  const { type, data } = richContent;

  switch (type) {
    case "table_list":
      return <TableListCard tables={data} onSelect={onQuickPick} />;
    case "column_info":
      return <ColumnInfoCard info={data} />;
    case "scatter_plot":
      return <ScatterPlotCard result={data} />;
    case "cluster_cards":
      return <ClusterCardsRow clusters={data} />;
    case "kpi_lift_chart":
      return <KpiLiftChart result={data} />;
    case "context_card":
      return <ContextCard context={data} />;
    case "persona_card":
      return <PersonaCard persona={data} />;
    case "action_cards":
      return <ActionCardsGrid actions={data} />;
    case "compare_card":
      return <CompareCard compare={data} />;
    case "quick_picks":
      return <QuickPickButtons picks={data} onPick={onQuickPick} />;
    default:
      return null;
  }
}

function TableListCard({ tables, onSelect }: { tables: { name: string; type: string }[]; onSelect: (s: string) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card space-y-1">
      {tables.map((t, i) => (
        <button key={i} onClick={() => onSelect(`Use ${t.name}`)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl hover:bg-navy-50 transition-all duration-200 text-left group">
          <span className="text-[15px] text-navy-800 font-semibold">{t.name}</span>
          <span className="text-[12px] text-navy-400 uppercase font-medium">{t.type}</span>
        </button>
      ))}
      <p className="text-[13px] text-navy-400 pt-2 font-medium">Click a table to select it.</p>
    </div>
  );
}

function ColumnInfoCard({ info }: { info: TableInfo }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {info.columns.slice(0, 20).map((col, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-navy-50 rounded-xl">
            <span className="text-[13px] font-semibold text-navy-700 truncate">{col.name}</span>
            <span className="text-[11px] text-navy-400 uppercase shrink-0 font-medium">{col.type}</span>
          </div>
        ))}
      </div>
      {info.columns.length > 20 && (
        <p className="text-[13px] text-navy-400 mt-3 font-medium">...and {info.columns.length - 20} more columns</p>
      )}
    </div>
  );
}

function ScatterPlotCard({ result }: { result: SegmentResult }) {
  const traces = Array.from(new Set(result.points.map(p => p.cluster))).sort().map(cid => {
    const pts = result.points.filter(p => p.cluster === cid);
    return {
      x: pts.map(p => p.x),
      y: pts.map(p => p.y),
      mode: "markers" as const,
      type: "scattergl" as const,
      name: `Cluster ${cid}`,
      marker: {
        color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
        size: 5,
        opacity: 0.75,
      },
    };
  });

  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
      <Plot
        data={traces}
        layout={{
          height: 380,
          margin: { t: 20, r: 20, b: 45, l: 45 },
          xaxis: { title: { text: "UMAP-1", font: { size: 13, color: "#64748B" } }, showgrid: false },
          yaxis: { title: { text: "UMAP-2", font: { size: 13, color: "#64748B" } }, showgrid: false },
          legend: { orientation: "h", y: -0.15, font: { size: 12 } },
          paper_bgcolor: "white",
          plot_bgcolor: "white",
          font: { family: "Inter, system-ui, sans-serif" },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
      <div className="mt-3 text-[13px] text-navy-500 text-center font-medium">
        Silhouette Score: {result.silhouette_score.toFixed(3)} | {result.n_clusters} clusters | {result.points.length.toLocaleString()} points
      </div>
    </div>
  );
}

function ClusterCardsRow({ clusters }: { clusters: ClusterSummary[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {clusters.map(c => (
        <div key={c.cluster_id} className="bg-white rounded-2xl border border-navy-200 px-5 py-4 min-w-[120px] shadow-card">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[c.cluster_id % CLUSTER_COLORS.length] }} />
            <span className="text-[14px] font-bold text-navy-800">C{c.cluster_id}</span>
          </div>
          <div className="text-xl font-bold text-navy-900">{c.size.toLocaleString()}</div>
          <div className="text-[13px] text-navy-400 font-medium">{c.percentage.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  );
}

function KpiLiftChart({ result }: { result: KpiLiftResult }) {
  const sorted = [...result.cluster_lifts].sort((a, b) => b.lift_pct - a.lift_pct);
  const maxAbs = Math.max(...sorted.map(l => Math.abs(l.lift_pct)), 1);

  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card space-y-2.5">
      {sorted.map((lift: ClusterLift) => {
        const pct = lift.lift_pct;
        const barWidth = Math.min(Math.abs(pct) / maxAbs * 100, 100);
        const isPositive = pct >= 0;
        return (
          <div key={lift.cluster_id} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-20 shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[lift.cluster_id % CLUSTER_COLORS.length] }} />
              <span className="text-[13px] font-semibold text-navy-700">C{lift.cluster_id}</span>
            </div>
            <div className="flex-1 h-6 bg-navy-100 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isPositive ? "bg-emerald-400" : "bg-red-400"}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <div className={`text-[13px] font-bold w-16 text-right ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
              {isPositive ? "+" : ""}{pct.toFixed(1)}%
            </div>
            <div className="text-[13px] text-navy-400 w-20 text-right font-medium">{formatNumber(lift.cluster_mean)}</div>
          </div>
        );
      })}
      <div className="text-[13px] text-navy-400 pt-2 border-t border-navy-100 font-medium">
        Global mean: {formatNumber(result.global_mean)}
      </div>
    </div>
  );
}

function ContextCard({ context }: { context: ContextResult }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[context.cluster_id % CLUSTER_COLORS.length] }} />
        <span className="text-[15px] font-bold text-navy-800">{context.segment_label}</span>
        <span className="text-[13px] text-navy-400 font-medium">Cluster {context.cluster_id}</span>
      </div>
      <p className="text-[15px] text-navy-600 mb-4 leading-relaxed">{context.context_summary}</p>
      {context.defining_features.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-bold text-navy-500 uppercase tracking-wider">Defining Features</div>
          {context.defining_features.slice(0, 6).map((f: DefiningFeature, i: number) => {
            const barPct = Math.min(Math.abs(f.index) / 3 * 100, 100);
            const isHigh = f.index >= 0;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[13px] text-navy-600 w-32 truncate shrink-0 font-medium">{f.feature}</span>
                <div className="flex-1 h-4 bg-navy-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${isHigh ? "bg-accent-400" : "bg-amber-400"}`} style={{ width: `${barPct}%` }} />
                </div>
                <span className={`text-[13px] w-14 text-right font-bold ${isHigh ? "text-accent-600" : "text-amber-600"}`}>
                  {f.index >= 0 ? "+" : ""}{f.index.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PersonaCard({ persona }: { persona: PersonaResult }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center">
          <User className="w-5 h-5 text-accent-600" />
        </div>
        <span className="text-[15px] font-bold text-navy-800">Persona - Cluster {persona.cluster_id}</span>
      </div>
      <blockquote className="text-[15px] text-navy-600 italic border-l-4 border-accent-300 pl-5 py-2 bg-accent-50/50 rounded-r-xl leading-relaxed">
        {persona.persona}
      </blockquote>
    </div>
  );
}

function ActionCardsGrid({ actions }: { actions: ActionsResult }) {
  const priorityColor: Record<string, string> = {
    high: "bg-red-50 text-red-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {actions.actions.map((a: ActionItem, i: number) => (
        <div key={i} className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
          <div className="flex items-start justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-brand-500" />
              <span className="text-[14px] font-bold text-navy-800">{a.title}</span>
            </div>
            <span className={`text-[11px] px-2.5 py-1 rounded-lg font-bold ${priorityColor[a.priority] || "bg-navy-100 text-navy-600"}`}>
              {a.priority}
            </span>
          </div>
          <p className="text-[13px] text-navy-600 mb-3 leading-relaxed">{a.description}</p>
          <div className="flex gap-4 text-[12px] text-navy-400 font-medium">
            <span>Target: {a.target_kpi}</span>
            <span>Lift: {a.expected_lift}</span>
            <span>Effort: {a.effort}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompareCard({ compare }: { compare: CompareResult }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-200 p-5 shadow-card">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[compare.cluster_a % CLUSTER_COLORS.length] }} />
          <span className="text-[14px] font-bold text-navy-800">C{compare.cluster_a}</span>
        </div>
        <span className="text-[13px] text-navy-400 font-medium">vs</span>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[compare.cluster_b % CLUSTER_COLORS.length] }} />
          <span className="text-[14px] font-bold text-navy-800">C{compare.cluster_b}</span>
        </div>
      </div>
      <p className="text-[15px] text-navy-600 mb-4 leading-relaxed">{compare.summary}</p>
      {compare.differences.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-navy-200">
                <th className="text-left py-2 text-navy-500 font-semibold">Feature</th>
                <th className="text-right py-2 text-navy-500 font-semibold">C{compare.cluster_a}</th>
                <th className="text-right py-2 text-navy-500 font-semibold">C{compare.cluster_b}</th>
                <th className="text-right py-2 text-navy-500 font-semibold">Delta</th>
              </tr>
            </thead>
            <tbody>
              {compare.differences.slice(0, 8).map((d, i) => (
                <tr key={i} className="border-b border-navy-100">
                  <td className="py-2 text-navy-700 font-medium">{d.feature}</td>
                  <td className="py-2 text-right text-navy-600">{formatNumber(d.cluster_a_value)}</td>
                  <td className="py-2 text-right text-navy-600">{formatNumber(d.cluster_b_value)}</td>
                  <td className={`py-2 text-right font-bold ${d.delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {d.delta >= 0 ? "+" : ""}{formatNumber(d.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuickPickButtons({ picks, onPick }: { picks: number[]; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {picks.map(p => (
        <button key={p} onClick={() => onPick(String(p))}
          className="border border-accent-200 text-accent-600 bg-accent-50 rounded-xl px-5 py-2 text-[14px] font-bold hover:bg-accent-100 transition-all duration-200">
          {p}
        </button>
      ))}
    </div>
  );
}

// -- Util --

function formatNumber(n: number): string {
  if (n == null) return "-";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
