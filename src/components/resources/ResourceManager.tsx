import React, { useState } from 'react';
import {
  Database, Plus, Edit2, Trash2, ExternalLink, Search, Filter,
  CheckCircle, XCircle, Key, Tag
} from 'lucide-react';
import type { Resource, ResourceCategory } from '../../types';
import { defaultResources } from '../../data/mockData';
import { useLocalStorage } from '../../hooks/useLocalStorage';

const CATEGORY_COLORS: Record<ResourceCategory, string> = {
  satellite: 'badge-purple',
  aircraft: 'badge-blue',
  ship: 'badge-blue',
  camera: 'badge-purple',
  scanner: 'badge-green',
  person: 'badge-red',
  phone: 'badge-yellow',
  address: 'badge-blue',
  social: 'badge-blue',
  darkweb: 'badge-red',
  ai: 'badge-purple',
  other: 'badge-yellow',
};

const CATEGORIES: ResourceCategory[] = [
  'satellite', 'aircraft', 'ship', 'camera', 'scanner',
  'person', 'phone', 'address', 'social', 'ai', 'other',
];

const emptyForm = {
  name: '', category: 'other' as ResourceCategory, url: '',
  description: '', requiresAuth: false, apiKey: '', tags: '',
};

const ResourceManager: React.FC = () => {
  const [resources, setResources] = useLocalStorage<Resource[]>('watcher-resources', defaultResources);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const filtered = resources.filter((r) => {
    const matchSearch =
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchCat = categoryFilter === 'all' || r.category === categoryFilter;
    return matchSearch && matchCat;
  });

  const handleSave = () => {
    if (!form.name || !form.url) return;
    if (editingId) {
      setResources((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                ...r,
                ...form,
                tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
              }
            : r
        )
      );
    } else {
      const newResource: Resource = {
        id: `res-${Date.now()}`,
        ...form,
        isEnabled: true,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      setResources((prev) => [...prev, newResource]);
    }
    setForm(emptyForm);
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (resource: Resource) => {
    setForm({
      name: resource.name,
      category: resource.category,
      url: resource.url,
      description: resource.description,
      requiresAuth: resource.requiresAuth,
      apiKey: resource.apiKey || '',
      tags: resource.tags.join(', '),
    });
    setEditingId(resource.id);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleEnabled = (id: string) => {
    setResources((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isEnabled: !r.isEnabled } : r))
    );
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search resources..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input-field sm:w-40"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm); }} className="btn-primary">
            <Plus size={15} />
            Add Resource
          </button>
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">
              {editingId ? 'Edit Resource' : 'Add New Resource'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <input className="input-field" placeholder="Resource name *" value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <select className="input-field" value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as ResourceCategory }))}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
              <input className="input-field" placeholder="URL *" value={form.url}
                onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} />
              <input className="input-field sm:col-span-2" placeholder="Description" value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.requiresAuth}
                    onChange={(e) => setForm((p) => ({ ...p, requiresAuth: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600" />
                  <span className="text-sm text-gray-400">Requires API Key</span>
                </label>
              </div>
              {form.requiresAuth && (
                <input className="input-field" placeholder="API Key (optional)" type="password" value={form.apiKey}
                  onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))} />
              )}
              <input className="input-field" placeholder="Tags (comma separated)" value={form.tags}
                onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} />
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={handleSave} className="btn-primary">
                <CheckCircle size={15} />
                {editingId ? 'Update' : 'Save'}
              </button>
              <button onClick={handleCancel} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Resources', value: resources.length, color: 'text-gray-400' },
          { label: 'Enabled', value: resources.filter((r) => r.isEnabled).length, color: 'text-green-400' },
          { label: 'Require Auth', value: resources.filter((r) => r.requiresAuth).length, color: 'text-yellow-400' },
          { label: 'Categories', value: new Set(resources.map((r) => r.category)).size, color: 'text-blue-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Resource list */}
      <div className="card">
        <div className="card-header">
          <Filter size={16} className="text-gray-400" />
          <h3 className="section-title">Resource Library</h3>
          <span className="badge badge-blue ml-auto">{filtered.length} resources</span>
        </div>

        <div className="space-y-2">
          {filtered.map((resource) => (
            <div
              key={resource.id}
              className={`p-3 rounded-lg border transition-all ${
                resource.isEnabled
                  ? 'bg-gray-900 border-gray-800 hover:border-gray-600'
                  : 'bg-gray-900/30 border-gray-800/50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-medium text-gray-200">{resource.name}</h4>
                      <span className={`badge ${CATEGORY_COLORS[resource.category]}`}>
                        {resource.category}
                      </span>
                      {resource.requiresAuth && (
                        <span className="badge badge-yellow text-xs flex items-center gap-1">
                          <Key size={10} />
                          Auth
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{resource.description}</p>
                    {resource.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {resource.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="flex items-center gap-0.5 text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                            <Tag size={9} />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {resource.requiresAuth && resource.apiKey && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-gray-600">API Key:</span>
                        <code className="text-xs font-mono text-gray-500">
                          {showKeys[resource.id]
                            ? resource.apiKey
                            : '•'.repeat(Math.min(resource.apiKey.length, 20))}
                        </code>
                        <button
                          onClick={() => setShowKeys((p) => ({ ...p, [resource.id]: !p[resource.id] }))}
                          className="text-xs text-gray-600 hover:text-gray-400"
                        >
                          {showKeys[resource.id] ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded"
                    title="Open resource"
                  >
                    <ExternalLink size={14} />
                  </a>
                  <button
                    onClick={() => handleEdit(resource)}
                    className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-800 rounded"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => toggleEnabled(resource.id)}
                    className={`p-1.5 rounded hover:bg-gray-800 ${
                      resource.isEnabled ? 'text-green-400' : 'text-gray-600'
                    }`}
                    title={resource.isEnabled ? 'Disable' : 'Enable'}
                  >
                    {resource.isEnabled ? <CheckCircle size={14} /> : <XCircle size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(resource.id)}
                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              <Database size={32} className="mx-auto mb-2" />
              <p>No resources match your search</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResourceManager;
