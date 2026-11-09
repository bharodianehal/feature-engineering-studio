import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProjects, createProject, archiveProject,
  getCatalogs, getSchemas, getTables,
} from "../api";
import type { Project, SourceTableRef } from "../api";
import {
  Plus, Loader2, FolderOpen, Trash2, Database, Table2,
  ChevronRight, X,
} from "lucide-react";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    getProjects().then(setProjects).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Archive this project?")) return;
    await archiveProject(id);
    load();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 tracking-tight">Projects</h1>
          <p className="text-[15px] text-navy-500 mt-1.5">
            Each project targets one or more source tables for feature engineering
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-all duration-200 shadow-sm hover:shadow-md">
          <Plus className="w-4 h-4" />New Project
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-navy-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-14 text-center">
          <div className="w-14 h-14 rounded-2xl bg-navy-100 flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-7 h-7 text-navy-400" />
          </div>
          <div className="text-lg font-semibold text-navy-800 mb-2">No projects yet</div>
          <div className="text-[15px] text-navy-500 mb-6">
            Create a project to start exploring data and engineering features
          </div>
          <button onClick={() => setShowCreate(true)}
            className="px-5 py-2.5 text-[14px] font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 shadow-sm">
            <Plus className="w-4 h-4 inline mr-1.5" />Create your first project
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map(p => (
            <div key={p.project_id}
              onClick={() => navigate(`/projects/${p.project_id}`)}
              className="bg-white rounded-2xl shadow-card px-6 py-5 flex items-center gap-5 hover:shadow-card-hover cursor-pointer transition-all duration-200 group">
              <div className="w-11 h-11 rounded-xl bg-navy-100 flex items-center justify-center shrink-0">
                <FolderOpen className="w-5 h-5 text-navy-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-semibold text-navy-900 truncate">{p.name}</div>
                <div className="text-[13px] text-navy-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {(p.tables && p.tables.length > 0 ? p.tables : [{ catalog: p.catalog, schema_name: p.schema_name, table: p.source_table }]).map((t, i) => (
                    <span key={i} className="font-mono text-[12px]">{t.catalog}.{t.schema_name}.{t.table}</span>
                  ))}
                </div>
                {p.description && (
                  <div className="text-[13px] text-navy-400 truncate mt-1">{p.description}</div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {p.feature_count > 0 && (
                  <div className="flex items-center gap-2">
                    {(p.feature_count - p.approved_count - p.materialized_count) > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {p.feature_count - p.approved_count - p.materialized_count} pending
                      </span>
                    )}
                    {p.approved_count > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {p.approved_count} approved
                      </span>
                    )}
                    {p.materialized_count > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        {p.materialized_count} materialized
                      </span>
                    )}
                  </div>
                )}
                <div className="text-[12px] text-navy-400">
                  {p.created_by?.split("@")[0]}
                  <br />{p.created_at?.split(" ")[0]}
                </div>
                <button onClick={e => handleArchive(e, p.project_id)}
                  className="opacity-0 group-hover:opacity-100 p-2 text-navy-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
                <ChevronRight className="w-5 h-5 text-navy-300" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateProjectDialog onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); navigate(`/projects/${id}`); }} />}
    </div>
  );
}

/* -- Multi-table Create Project Dialog -- */

interface SchemaTablesMap {
  [schema: string]: { name: string; type: string }[];
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [cat, setCat] = useState("");
  const [outTable, setOutTable] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadState, setLoadState] = useState("");

  const [schemas, setSchemas] = useState<string[]>([]);
  const [schemaTables, setSchemaTables] = useState<SchemaTablesMap>({});
  const [selectedTables, setSelectedTables] = useState<SourceTableRef[]>([]);
  const [activeSchema, setActiveSchema] = useState("");
  const [schemaLoading, setSchemaLoading] = useState("");

  useEffect(() => { setLoadState("c"); getCatalogs().then(setCatalogs).finally(() => setLoadState("")); }, []);

  useEffect(() => {
    if (!cat) { setSchemas([]); setSchemaTables({}); setSelectedTables([]); setActiveSchema(""); return; }
    setSchemas([]); setSchemaTables({}); setSelectedTables([]); setActiveSchema("");
    setLoadState("s"); getSchemas(cat).then(setSchemas).finally(() => setLoadState(""));
  }, [cat]);

  const loadTablesForSchema = (schema: string) => {
    if (schemaTables[schema]) return;
    setSchemaLoading(schema);
    getTables(cat, schema).then(tables => {
      setSchemaTables(prev => ({ ...prev, [schema]: tables }));
    }).finally(() => setSchemaLoading(""));
  };

  const toggleSchema = (schema: string) => {
    if (activeSchema === schema) {
      setActiveSchema("");
    } else {
      setActiveSchema(schema);
      loadTablesForSchema(schema);
    }
  };

  const toggleTable = (schema: string, tableName: string) => {
    setSelectedTables(prev => {
      const exists = prev.some(t => t.schema_name === schema && t.table === tableName);
      if (exists) return prev.filter(t => !(t.schema_name === schema && t.table === tableName));
      return [...prev, { catalog: cat, schema_name: schema, table: tableName }];
    });
  };

  const removeTable = (schema: string, tableName: string) => {
    setSelectedTables(prev => prev.filter(t => !(t.schema_name === schema && t.table === tableName)));
  };

  const isTableSelected = (schema: string, tableName: string) =>
    selectedTables.some(t => t.schema_name === schema && t.table === tableName);

  const handleCreate = async () => {
    if (!name.trim() || !cat || selectedTables.length === 0) return;
    setCreating(true);
    try {
      const r = await createProject({
        name: name.trim(),
        description: description.trim(),
        catalog: cat,
        tables: selectedTables,
        output_table: outTable.trim() || undefined,
      });
      onCreated(r.project_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-elevated w-[600px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-7 py-5 border-b border-navy-200">
          <h2 className="text-lg font-bold text-navy-900 tracking-tight">New Project</h2>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-600 p-1 hover:bg-navy-100 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-7 space-y-5">
          <div>
            <label className="block text-[14px] font-semibold text-navy-700 mb-1.5">Project Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Retail Churn Model"
              className="w-full px-4 py-2.5 text-[15px] border border-navy-200 rounded-xl text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 bg-white" />
          </div>
          <div>
            <label className="block text-[14px] font-semibold text-navy-700 mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What is this project for?"
              className="w-full px-4 py-2.5 text-[15px] border border-navy-200 rounded-xl text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 bg-white" />
          </div>

          {/* Catalog */}
          <div className="border-t border-navy-100 pt-5">
            <div className="text-[14px] font-semibold text-navy-700 mb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-navy-400" />Source Tables
            </div>
            <div>
              <label className="block text-[13px] text-navy-500 mb-1.5">Catalog</label>
              <select value={cat} onChange={e => setCat(e.target.value)}
                className="w-full px-4 py-2.5 text-[15px] border border-navy-200 rounded-xl bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-brand-300">
                <option value="">{loadState === "c" ? "Loading..." : "Select catalog..."}</option>
                {catalogs.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Schema browser */}
          {cat && (
            <div className="border border-navy-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-navy-50 border-b border-navy-200 text-[12px] font-semibold text-navy-500 uppercase tracking-wider">
                {loadState === "s" ? "Loading schemas..." : `Schemas in ${cat}`}
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {schemas.map(schema => {
                  const tables = schemaTables[schema] || [];
                  const isOpen = activeSchema === schema;
                  const selectedCount = selectedTables.filter(t => t.schema_name === schema).length;
                  return (
                    <div key={schema}>
                      <button onClick={() => toggleSchema(schema)}
                        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-left hover:bg-navy-50 transition-colors ${
                          isOpen ? "bg-navy-50 font-medium text-navy-800" : "text-navy-700"
                        }`}>
                        <ChevronRight className={`w-4 h-4 text-navy-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        <Database className="w-4 h-4 text-navy-400" />
                        {schema}
                        {selectedCount > 0 && (
                          <span className="ml-auto text-[12px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-600 font-semibold">{selectedCount}</span>
                        )}
                      </button>
                      {isOpen && (
                        <div className="border-t border-navy-100 bg-white">
                          {schemaLoading === schema ? (
                            <div className="flex items-center gap-2 px-7 py-3 text-[14px] text-navy-400">
                              <Loader2 className="w-4 h-4 animate-spin" />Loading tables...
                            </div>
                          ) : tables.length === 0 ? (
                            <div className="px-7 py-3 text-[14px] text-navy-400">No tables found</div>
                          ) : (
                            tables.map(t => {
                              const selected = isTableSelected(schema, t.name);
                              return (
                                <button key={t.name} onClick={() => toggleTable(schema, t.name)}
                                  className={`w-full flex items-center gap-2.5 px-7 py-2 text-[14px] text-left transition-colors ${
                                    selected ? "bg-brand-50 text-brand-700" : "text-navy-700 hover:bg-navy-50"
                                  }`}>
                                  <input type="checkbox" checked={selected} readOnly
                                    className="rounded border-navy-300 text-brand-500 w-4 h-4 pointer-events-none" />
                                  <Table2 className="w-4 h-4 text-navy-400" />
                                  <span className="font-mono text-[13px]">{t.name}</span>
                                  <span className="text-[11px] text-navy-400 ml-auto">{t.type}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected tables chips */}
          {selectedTables.length > 0 && (
            <div>
              <label className="block text-[13px] text-navy-500 mb-2">Selected ({selectedTables.length})</label>
              <div className="flex flex-wrap gap-2">
                {selectedTables.map(t => (
                  <span key={`${t.schema_name}.${t.table}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-mono bg-brand-50 text-brand-700 rounded-lg border border-brand-200/60">
                    {t.schema_name}.{t.table}
                    <button onClick={() => removeTable(t.schema_name, t.table)}
                      className="text-brand-400 hover:text-red-500 ml-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[14px] font-semibold text-navy-700 mb-1.5 flex items-center gap-2">
              <Table2 className="w-4 h-4 text-navy-400" />Output Table Name
              <span className="text-[12px] font-normal text-navy-400">(optional)</span>
            </label>
            <input type="text" value={outTable} onChange={e => setOutTable(e.target.value)}
              placeholder="auto-generated"
              className="w-full px-4 py-2.5 text-[15px] border border-navy-200 rounded-xl text-navy-800 font-mono focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white" />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-7 py-5 border-t border-navy-100">
          <button onClick={onClose} className="px-5 py-2.5 text-[14px] font-semibold text-navy-600 border border-navy-200 rounded-xl hover:bg-navy-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate} disabled={creating || !name.trim() || !cat || selectedTables.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 disabled:opacity-40 transition-all shadow-sm">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
