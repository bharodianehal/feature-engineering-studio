import { useEffect } from "react";
import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { Layers, FolderOpen, Zap, Brain, MessageSquare, Sparkles } from "lucide-react";
import { setupApp } from "./api";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import FeatureInventoryPage from "./pages/FeatureInventoryPage";
import FeatureDetailPage from "./pages/FeatureDetailPage";
import SegmentLandscapePage from "./pages/SegmentLandscapePage";
import SegmentChatPage from "./pages/SegmentChatPage";

export default function App() {
  useEffect(() => { setupApp().catch(() => {}); }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-navy-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId/*" element={<ProjectWorkspace />} />
          <Route path="segments" element={<SegmentLandscapePage />} />
          <Route path="segment-chat" element={<SegmentChatPage />} />
          <Route path="features" element={<FeatureInventoryPage />} />
          <Route path="features/:featureId" element={<FeatureDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="w-[260px] bg-navy-950 flex flex-col shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.06]">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-white leading-tight tracking-tight">Customer Intelligence</div>
          <div className="text-[11px] text-navy-400 font-medium tracking-wide">Databricks Studio</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {/* Feature Engineering section */}
        <div>
          <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest px-3 mb-2">
            Feature Engineering
          </div>
          <div className="space-y-0.5">
            <SidebarLink to="/projects" icon={<FolderOpen className="w-[18px] h-[18px]" />} label="Projects" />
            <SidebarLink to="/features" icon={<Zap className="w-[18px] h-[18px]" />} label="Feature Inventory" />
          </div>
        </div>

        {/* Segmentation section */}
        <div>
          <div className="text-[11px] font-semibold text-navy-500 uppercase tracking-widest px-3 mb-2">
            Segmentation
          </div>
          <div className="space-y-0.5">
            <SidebarLink to="/segments" icon={<Brain className="w-[18px] h-[18px]" />} label="Segment Explorer" />
            <SidebarLink to="/segment-chat" icon={<MessageSquare className="w-[18px] h-[18px]" />} label="Segment Genie" />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/[0.06]">
        <div className="text-[11px] text-navy-500 font-medium">Customer Intelligence Studio v4</div>
        <div className="text-[10px] text-navy-600 mt-0.5">Powered by Databricks</div>
      </div>
    </aside>
  );
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink to={to} end={to === "/projects"}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 ${
          isActive
            ? "bg-white/[0.08] text-white shadow-sm"
            : "text-navy-400 hover:bg-white/[0.04] hover:text-navy-200"
        }`
      }>
      {icon}
      {label}
    </NavLink>
  );
}
