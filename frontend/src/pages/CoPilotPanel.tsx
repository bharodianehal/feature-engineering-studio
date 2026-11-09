import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Loader2, Bot, User } from "lucide-react";
import { compareSegments, getPersona } from "../api";
import type { ClusterSummary } from "../api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CoPilotPanelProps {
  clusters: ClusterSummary[];
  tableLabel: string;
}

export default function CoPilotPanel({ clusters, tableLabel }: CoPilotPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const lower = text.toLowerCase();

      const compareMatch = lower.match(/compare\s+(?:cluster\s+)?(\\d+)\s+(?:and|vs|with|to)\s+(?:cluster\s+)?(\\d+)/);
      if (compareMatch) {
        const a = Number(compareMatch[1]);
        const b = Number(compareMatch[2]);
        const result = await compareSegments({
          cluster_a: a,
          cluster_b: b,
          clusters,
          table_name: tableLabel,
        });
        const diffLines = result.differences.slice(0, 5).map(
          d => `  - ${d.feature}: ${d.cluster_a_value.toFixed(2)} vs ${d.cluster_b_value.toFixed(2)} (delta: ${d.delta > 0 ? "+" : ""}${d.delta.toFixed(2)})`
        ).join("\n");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `${result.summary}\n\nKey differences:\n${diffLines}`,
        }]);
      }
      else if (lower.includes("persona")) {
        const clusterMatch = lower.match(/cluster\s+(\d+)/);
        const cid = clusterMatch ? Number(clusterMatch[1]) : 0;
        const cluster = clusters.find(c => c.cluster_id === cid);
        if (cluster) {
          const result = await getPersona({
            cluster_id: cluster.cluster_id,
            feature_means: cluster.feature_means,
            size: cluster.size,
            percentage: cluster.percentage,
            table_name: tableLabel,
          });
          setMessages(prev => [...prev, {
            role: "assistant",
            content: result.persona,
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: `I could not find cluster ${cid}. Available clusters: ${clusters.map(c => c.cluster_id).join(", ")}`,
          }]);
        }
      }
      else {
        const clusterInfo = clusters.map(c =>
          `Cluster ${c.cluster_id}: ${c.size.toLocaleString()} customers (${c.percentage.toFixed(1)}%)`
        ).join("\n");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `I can help you explore your segments. Here is a summary:\n\n${clusterInfo}\n\nTry asking:\n- "Compare cluster 0 and cluster 1"\n- "Persona for cluster 2"`,
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Sorry, something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 w-13 h-13 rounded-2xl bg-accent-500 text-white shadow-elevated hover:bg-accent-600 flex items-center justify-center transition-all duration-200 hover:scale-105 z-50">
        <Sparkles className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[420px] h-[520px] bg-white rounded-2xl shadow-elevated border border-navy-200 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-navy-900 text-white rounded-t-2xl">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-accent-300" />
          <span className="text-[14px] font-bold">CoPilot</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-navy-400 hover:text-white transition-colors p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <Bot className="w-9 h-9 text-navy-300 mx-auto mb-3" />
            <p className="text-[14px] text-navy-500 font-medium">
              Ask me about your segments.
            </p>
            <p className="text-[13px] text-navy-400 mt-1.5">
              Try: "Compare cluster 0 and 1" or "Persona for cluster 2"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-accent-600" />
              </div>
            )}
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-accent-500 text-white rounded-br-md"
                : "bg-navy-50 text-navy-800 rounded-bl-md"
            }`}>
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-lg bg-navy-200 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-4 h-4 text-navy-600" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5 justify-start">
            <div className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-accent-600" />
            </div>
            <div className="bg-navy-50 px-4 py-2.5 rounded-2xl rounded-bl-md">
              <Loader2 className="w-4 h-4 animate-spin text-accent-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-navy-200">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
            placeholder="Ask about your segments..."
            className="flex-1 px-4 py-2.5 text-[14px] border border-navy-200 rounded-xl text-navy-800 focus:outline-none focus:ring-2 focus:ring-accent-300 bg-navy-50"
          />
          <button onClick={handleSend} disabled={!input.trim() || loading}
            className="p-2.5 bg-accent-500 text-white rounded-xl hover:bg-accent-600 disabled:opacity-40 transition-all">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
