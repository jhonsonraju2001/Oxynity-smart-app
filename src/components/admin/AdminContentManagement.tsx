import React, { useState } from 'react';
import { AdminAnnouncement, AdminGuide, DeviceTelemetry } from '../../types/iot';
import {
  FileText,
  Megaphone,
  BookOpen,
  Plus,
  Search,
  Edit2,
  Trash2,
  Pin,
  CheckCircle2,
  AlertTriangle,
  X,
  Clock,
  Sparkles,
  Layers,
  Radio,
} from 'lucide-react';

interface AdminContentManagementProps {
  initialAnnouncements: AdminAnnouncement[];
  initialGuides: AdminGuide[];
  allPonds: DeviceTelemetry[];
  onAnnouncementsUpdated?: (announcements: AdminAnnouncement[]) => void;
  onGuidesUpdated?: (guides: AdminGuide[]) => void;
}

export const AdminContentManagement: React.FC<AdminContentManagementProps> = ({
  initialAnnouncements,
  initialGuides,
  allPonds,
  onAnnouncementsUpdated,
  onGuidesUpdated,
}) => {
  const [subTab, setSubTab] = useState<'announcements' | 'guides'>('announcements');

  // Announcements State
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>(() => {
    try {
      const saved = localStorage.getItem('oxynity_admin_announcements');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialAnnouncements;
  });

  // Guides State
  const [guides, setGuides] = useState<AdminGuide[]>(() => {
    try {
      const saved = localStorage.getItem('oxynity_admin_guides');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialGuides;
  });

  const [searchQuery, setSearchQuery] = useState('');

  // Announcement Modals
  const [showAddAnn, setShowAddAnn] = useState(false);
  const [editingAnn, setEditingAnn] = useState<AdminAnnouncement | null>(null);
  const [annForm, setAnnForm] = useState({
    title: '',
    category: 'advisory' as AdminAnnouncement['category'],
    targetPondId: '',
    message: '',
    isPinned: false,
    isActive: true,
  });

  // Guide Modals
  const [showAddGuide, setShowAddGuide] = useState(false);
  const [editingGuide, setEditingGuide] = useState<AdminGuide | null>(null);
  const [guideForm, setGuideForm] = useState({
    title: '',
    category: 'water_quality' as AdminGuide['category'],
    readTime: '5 min read',
    summary: '',
    content: '',
  });

  // Sync helpers
  const saveAnnouncements = (updated: AdminAnnouncement[]) => {
    setAnnouncements(updated);
    try {
      localStorage.setItem('oxynity_admin_announcements', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
    if (onAnnouncementsUpdated) onAnnouncementsUpdated(updated);
  };

  const saveGuides = (updated: AdminGuide[]) => {
    setGuides(updated);
    try {
      localStorage.setItem('oxynity_admin_guides', JSON.stringify(updated));
    } catch (e) {
      console.error(e);
    }
    if (onGuidesUpdated) onGuidesUpdated(updated);
  };

  // Announcement Handlers
  const handleOpenAddAnn = () => {
    setAnnForm({
      title: '',
      category: 'advisory',
      targetPondId: '',
      message: '',
      isPinned: false,
      isActive: true,
    });
    setShowAddAnn(true);
  };

  const handleOpenEditAnn = (ann: AdminAnnouncement) => {
    setEditingAnn(ann);
    setAnnForm({
      title: ann.title,
      category: ann.category,
      targetPondId: ann.targetPondId || '',
      message: ann.message,
      isPinned: ann.isPinned,
      isActive: ann.isActive,
    });
  };

  const handleSubmitAnn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!annForm.title.trim() || !annForm.message.trim()) return;

    if (editingAnn) {
      const updated = announcements.map((a) =>
        a.id === editingAnn.id
          ? {
              ...a,
              title: annForm.title.trim(),
              category: annForm.category,
              targetPondId: annForm.targetPondId || undefined,
              message: annForm.message.trim(),
              isPinned: annForm.isPinned,
              isActive: annForm.isActive,
            }
          : a
      );
      saveAnnouncements(updated);
      setEditingAnn(null);
    } else {
      const newAnn: AdminAnnouncement = {
        id: `ann-${Date.now()}`,
        title: annForm.title.trim(),
        category: annForm.category,
        targetPondId: annForm.targetPondId || undefined,
        message: annForm.message.trim(),
        isPinned: annForm.isPinned,
        isActive: annForm.isActive,
        createdAt: new Date().toISOString(),
        authorName: 'Oxynity Admin',
      };
      saveAnnouncements([newAnn, ...announcements]);
      setShowAddAnn(false);
    }
  };

  const handleToggleAnnActive = (ann: AdminAnnouncement) => {
    const updated = announcements.map((a) =>
      a.id === ann.id ? { ...a, isActive: !a.isActive } : a
    );
    saveAnnouncements(updated);
  };

  const handleDeleteAnn = (id: string) => {
    if (confirm('Delete this announcement?')) {
      saveAnnouncements(announcements.filter((a) => a.id !== id));
    }
  };

  // Guide Handlers
  const handleOpenAddGuide = () => {
    setGuideForm({
      title: '',
      category: 'water_quality',
      readTime: '5 min read',
      summary: '',
      content: '',
    });
    setShowAddGuide(true);
  };

  const handleOpenEditGuide = (guide: AdminGuide) => {
    setEditingGuide(guide);
    setGuideForm({
      title: guide.title,
      category: guide.category,
      readTime: guide.readTime,
      summary: guide.summary,
      content: guide.content,
    });
  };

  const handleSubmitGuide = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guideForm.title.trim() || !guideForm.content.trim()) return;

    if (editingGuide) {
      const updated = guides.map((g) =>
        g.id === editingGuide.id
          ? {
              ...g,
              title: guideForm.title.trim(),
              category: guideForm.category,
              readTime: guideForm.readTime.trim(),
              summary: guideForm.summary.trim(),
              content: guideForm.content.trim(),
              updatedAt: new Date().toISOString().split('T')[0],
            }
          : g
      );
      saveGuides(updated);
      setEditingGuide(null);
    } else {
      const newGuide: AdminGuide = {
        id: `gd-${Date.now()}`,
        title: guideForm.title.trim(),
        category: guideForm.category,
        readTime: guideForm.readTime.trim() || '5 min read',
        summary: guideForm.summary.trim(),
        content: guideForm.content.trim(),
        updatedAt: new Date().toISOString().split('T')[0],
      };
      saveGuides([newGuide, ...guides]);
      setShowAddGuide(false);
    }
  };

  const handleDeleteGuide = (id: string) => {
    if (confirm('Delete this guide article?')) {
      saveGuides(guides.filter((g) => g.id !== id));
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in select-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-sky-600" />
            Content Management Hub
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Publish broadcast advisories to operators & curate aquaculture guides
          </p>
        </div>

        <button
          type="button"
          onClick={subTab === 'announcements' ? handleOpenAddAnn : handleOpenAddGuide}
          className="px-3.5 py-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-700 hover:to-cyan-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{subTab === 'announcements' ? 'New Announcement' : 'New Guide'}</span>
        </button>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 gap-1 text-xs">
        <button
          type="button"
          onClick={() => setSubTab('announcements')}
          className={`flex-1 py-2 rounded-xl font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            subTab === 'announcements'
              ? 'bg-white text-sky-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Megaphone className="w-3.5 h-3.5" />
          <span>Broadcast Notices ({announcements.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('guides')}
          className={`flex-1 py-2 rounded-xl font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            subTab === 'guides'
              ? 'bg-white text-sky-700 shadow-xs'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Knowledge Library ({guides.length})</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder={
            subTab === 'announcements'
              ? 'Search announcements by title or content...'
              : 'Search articles, procedures or guides...'
          }
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-11 pl-10 pr-4 bg-white rounded-2xl border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all shadow-xs"
        />
      </div>

      {/* TAB 1: ANNOUNCEMENTS */}
      {subTab === 'announcements' && (
        <div className="space-y-3">
          {announcements
            .filter((a) =>
              a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              a.message.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .map((ann) => {
              const catColors =
                ann.category === 'emergency'
                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                  : ann.category === 'weather'
                  ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                  : ann.category === 'maintenance'
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : 'bg-sky-100 text-sky-800 border-sky-200';

              return (
                <div
                  key={ann.id}
                  className={`bg-white rounded-3xl border transition-all p-4 space-y-2.5 shadow-xs ${
                    ann.isActive ? 'border-slate-200' : 'border-slate-200/60 opacity-60 bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase border ${catColors}`}>
                        {ann.category}
                      </span>
                      {ann.isPinned && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-extrabold">
                          <Pin className="w-2.5 h-2.5" /> Pinned
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(ann.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleAnnActive(ann)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                          ann.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {ann.isActive ? 'Active' : 'Draft'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditAnn(ann)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteAnn(ann.id)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <h4 className="text-sm font-extrabold text-slate-900 leading-snug">{ann.title}</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">{ann.message}</p>

                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                    <span>Target: <strong className="text-slate-700 font-semibold">{ann.targetPondId ? ann.targetPondId : 'All Operator Basins'}</strong></span>
                    <span>By: {ann.authorName}</span>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* TAB 2: GUIDES */}
      {subTab === 'guides' && (
        <div className="space-y-3">
          {guides
            .filter((g) =>
              g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              g.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
              g.content.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .map((guide) => (
              <div
                key={guide.id}
                className="bg-white rounded-3xl border border-slate-200 p-4 space-y-2.5 shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-black uppercase">
                      {guide.category.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {guide.readTime}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEditGuide(guide)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGuide(guide.id)}
                      className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h4 className="text-sm font-extrabold text-slate-900">{guide.title}</h4>
                <p className="text-xs text-slate-600 leading-relaxed font-medium">{guide.summary}</p>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-[11px] text-slate-700 leading-relaxed">
                  {guide.content}
                </div>

                <div className="text-[10px] text-slate-400 text-right">
                  Updated: {guide.updatedAt}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* MODAL: ADD / EDIT ANNOUNCEMENT */}
      {(showAddAnn || editingAnn) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-sky-600 to-cyan-600 text-white flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Megaphone className="w-4 h-4" />
                {editingAnn ? 'Edit Broadcast Announcement' : 'New Broadcast Announcement'}
              </h3>
              <button
                onClick={() => {
                  setShowAddAnn(false);
                  setEditingAnn(null);
                }}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitAnn} className="p-5 space-y-3.5 overflow-y-auto">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical Monsoon Oxygenation Advisory"
                  value={annForm.title}
                  onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Category</label>
                  <select
                    value={annForm.category}
                    onChange={(e) => setAnnForm({ ...annForm, category: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
                  >
                    <option value="advisory">Advisory Notice</option>
                    <option value="emergency">Emergency Alert</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="weather">Weather Warning</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Target Pond</label>
                  <select
                    value={annForm.targetPondId}
                    onChange={(e) => setAnnForm({ ...annForm, targetPondId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
                  >
                    <option value="">Broadcast to All Ponds</option>
                    {allPonds.map((p) => (
                      <option key={p.deviceId} value={p.deviceId}>
                        {p.deviceId} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Message Content *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Write clear instructions for pond operators..."
                  value={annForm.message}
                  onChange={(e) => setAnnForm({ ...annForm, message: e.target.value })}
                  className="w-full p-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annForm.isPinned}
                    onChange={(e) => setAnnForm({ ...annForm, isPinned: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span className="font-bold text-slate-700">Pin to top of operator app</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={annForm.isActive}
                    onChange={(e) => setAnnForm({ ...annForm, isActive: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                  />
                  <span className="font-bold text-slate-700">Publish Immediately</span>
                </label>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddAnn(false);
                    setEditingAnn(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold shadow-md"
                >
                  {editingAnn ? 'Save Announcement' : 'Publish Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT GUIDE */}
      {(showAddGuide || editingGuide) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-sky-600 to-cyan-600 text-white flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                {editingGuide ? 'Edit Aquaculture Guide' : 'New Aquaculture Guide'}
              </h3>
              <button
                onClick={() => {
                  setShowAddGuide(false);
                  setEditingGuide(null);
                }}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitGuide} className="p-5 space-y-3.5 overflow-y-auto">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Guide Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aerator Maintenance Protocol"
                  value={guideForm.title}
                  onChange={(e) => setGuideForm({ ...guideForm, title: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Category</label>
                  <select
                    value={guideForm.category}
                    onChange={(e) => setGuideForm({ ...guideForm, category: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white"
                  >
                    <option value="water_quality">Water Quality</option>
                    <option value="aeration">Aeration</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="hardware">Hardware / Sensor</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Estimated Read Time</label>
                  <input
                    type="text"
                    placeholder="e.g. 5 min read"
                    value={guideForm.readTime}
                    onChange={(e) => setGuideForm({ ...guideForm, readTime: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Summary / Abstract</label>
                <input
                  type="text"
                  placeholder="Brief one-line summary..."
                  value={guideForm.summary}
                  onChange={(e) => setGuideForm({ ...guideForm, summary: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Full Article Content *</label>
                <textarea
                  rows={5}
                  required
                  placeholder="Detailed guidelines, troubleshooting instructions, procedures..."
                  value={guideForm.content}
                  onChange={(e) => setGuideForm({ ...guideForm, content: e.target.value })}
                  className="w-full p-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none leading-relaxed"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddGuide(false);
                    setEditingGuide(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold shadow-md"
                >
                  {editingGuide ? 'Save Guide' : 'Publish Guide'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
