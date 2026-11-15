import React, { useState, useEffect } from 'react';
import { AdminUser, DeviceTelemetry } from '../../types/iot';
import {
  Users,
  UserPlus,
  Search,
  Edit2,
  Trash2,
  Shield,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  X,
  Phone,
  Mail,
  Building,
  Check,
  Radio,
  AlertTriangle,
} from 'lucide-react';

interface AdminUserManagementProps {
  initialUsers: AdminUser[];
  allPonds: DeviceTelemetry[];
  onUsersUpdated?: (users: AdminUser[]) => void;
}

export const AdminUserManagement: React.FC<AdminUserManagementProps> = ({
  initialUsers,
  allPonds,
  onUsersUpdated,
}) => {
  const [users, setUsers] = useState<AdminUser[]>(() => {
    try {
      const saved = localStorage.getItem('oxynity_admin_users');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialUsers;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'operator' | 'admin' | 'supervisor'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'suspended'>('ALL');

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'operator' as 'operator' | 'admin' | 'supervisor',
    status: 'active' as 'active' | 'suspended',
    facilityName: '',
    assignedPondIds: [] as string[],
  });

  // Sync users to localStorage & notify parent
  const saveUsers = (updatedUsers: AdminUser[]) => {
    setUsers(updatedUsers);
    try {
      localStorage.setItem('oxynity_admin_users', JSON.stringify(updatedUsers));
      // Sync each user's assigned ponds to oxynity_user_ponds_<email>
      updatedUsers.forEach((u) => {
        const cleanEmail = u.email.trim().toLowerCase();
        localStorage.setItem(`oxynity_user_ponds_${cleanEmail}`, JSON.stringify(u.assignedPondIds));
      });
    } catch (e) {
      console.error(e);
    }
    if (onUsersUpdated) onUsersUpdated(updatedUsers);
  };

  const handleOpenAdd = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      role: 'operator',
      status: 'active',
      facilityName: '',
      assignedPondIds: allPonds.length > 0 ? [allPonds[0].deviceId] : [],
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (user: AdminUser) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      facilityName: user.facilityName || '',
      assignedPondIds: [...user.assignedPondIds],
    });
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.email.trim()) return;

    const newUser: AdminUser = {
      id: `usr-${Date.now()}`,
      name: formData.name.trim(),
      email: formData.email.trim().toLowerCase(),
      phone: formData.phone.trim(),
      role: formData.role,
      status: formData.status,
      assignedPondIds: formData.assignedPondIds,
      facilityName: formData.facilityName.trim(),
      createdAt: new Date().toISOString().split('T')[0],
      lastLogin: 'Never',
    };

    saveUsers([newUser, ...users]);
    setShowAddModal(false);
  };

  const handleSubmitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const updated = users.map((u) =>
      u.id === editingUser.id
        ? {
            ...u,
            name: formData.name.trim(),
            email: formData.email.trim().toLowerCase(),
            phone: formData.phone.trim(),
            role: formData.role,
            status: formData.status,
            facilityName: formData.facilityName.trim(),
            assignedPondIds: formData.assignedPondIds,
          }
        : u
    );

    saveUsers(updated);
    setEditingUser(null);
  };

  const handleToggleStatus = (user: AdminUser) => {
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    const updated = users.map((u) =>
      u.id === user.id ? { ...u, status: nextStatus as 'active' | 'suspended' } : u
    );
    saveUsers(updated);
  };

  const handleConfirmDelete = () => {
    if (!deletingUser) return;
    const updated = users.filter((u) => u.id !== deletingUser.id);
    saveUsers(updated);
    setDeletingUser(null);
  };

  const togglePondAssignment = (pondId: string) => {
    setFormData((prev) => {
      const exists = prev.assignedPondIds.includes(pondId);
      const nextPonds = exists
        ? prev.assignedPondIds.filter((id) => id !== pondId)
        : [...prev.assignedPondIds, pondId];
      return { ...prev, assignedPondIds: nextPonds };
    });
  };

  // Filter users
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone.includes(q) ||
      (u.facilityName && u.facilityName.toLowerCase().includes(q)) ||
      u.assignedPondIds.some((pid) => pid.toLowerCase().includes(q));

    const matchRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchStatus = statusFilter === 'ALL' || u.status === statusFilter;

    return matchSearch && matchRole && matchStatus;
  });

  return (
    <div className="space-y-4 animate-in fade-in select-none">
      {/* Header & Add User Button */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-600" />
            User Management & Access Control
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Manage operator accounts, roles, credentials, and assigned pond IDs
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="px-3.5 py-2 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-700 hover:to-cyan-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md hover:shadow-lg transition-all cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add User</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Total Users</span>
          <span className="text-xl font-black text-slate-900 font-mono mt-0.5 block">{users.length}</span>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Active Operators</span>
          <span className="text-xl font-black text-emerald-600 font-mono mt-0.5 block">
            {users.filter((u) => u.status === 'active' && u.role === 'operator').length}
          </span>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-extrabold uppercase text-slate-400 block">Admins / Supervisors</span>
          <span className="text-xl font-black text-sky-600 font-mono mt-0.5 block">
            {users.filter((u) => u.role === 'admin' || u.role === 'supervisor').length}
          </span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, email, phone, facility or pond ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-4 bg-white rounded-2xl border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all shadow-xs"
          />
        </div>

        {/* Role Segment Filters */}
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1 text-xs">
          {(['ALL', 'operator', 'supervisor', 'admin'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer ${
                roleFilter === r
                  ? 'bg-white text-sky-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {r === 'ALL' ? `All (${users.length})` : r}
            </button>
          ))}
        </div>
      </div>

      {/* User Cards List */}
      <div className="space-y-3">
        {filteredUsers.map((u) => {
          const initial = u.name.charAt(0).toUpperCase();
          const isActive = u.status === 'active';

          return (
            <div
              key={u.id}
              className={`bg-white rounded-3xl border transition-all p-4 space-y-3 shadow-xs ${
                isActive ? 'border-slate-200/90' : 'border-amber-200 bg-amber-50/20'
              }`}
            >
              {/* User Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-600 to-cyan-600 text-white font-black text-base flex items-center justify-center shrink-0 shadow-md">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-extrabold text-slate-900 truncate">{u.name}</h4>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                          u.role === 'admin'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'supervisor'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {u.role}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-bold ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {isActive ? 'ACTIVE' : 'SUSPENDED'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap font-medium">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-slate-400" />
                        {u.email}
                      </span>
                      {u.phone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {u.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Edit / Suspend / Delete Action Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(u)}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                    title="Edit User"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleStatus(u)}
                    className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                    }`}
                    title={isActive ? 'Suspend User' : 'Activate User'}
                  >
                    {isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeletingUser(u)}
                    className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors cursor-pointer"
                    title="Delete User"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Facility & Assigned Ponds */}
              <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200 text-xs space-y-1.5">
                {u.facilityName && (
                  <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                    <Building className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span>{u.facilityName}</span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200/80">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400">Assigned Ponds:</span>
                  {u.assignedPondIds && u.assignedPondIds.length > 0 ? (
                    u.assignedPondIds.map((pid) => (
                      <span
                        key={pid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[10px] font-mono font-bold text-sky-700"
                      >
                        <Radio className="w-2.5 h-2.5 text-sky-500" />
                        {pid}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-400 italic">No ponds assigned yet</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filteredUsers.length === 0 && (
          <div className="p-8 text-center text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200 text-xs">
            No users found matching your filters. Tap "Add User" to create one.
          </div>
        )}
      </div>

      {/* ADD / EDIT USER MODAL */}
      {(showAddModal || editingUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div
            className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-sky-600 to-cyan-600 text-white flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Users className="w-4 h-4" />
                {editingUser ? 'Edit User Account' : 'Add New User'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingUser(null);
                }}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={editingUser ? handleSubmitEdit : handleSubmitAdd}
              className="p-5 overflow-y-auto space-y-3.5 text-xs"
            >
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="operator@farm.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+91 98480 00000"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono focus:ring-2 focus:ring-sky-500 focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white focus:ring-2 focus:ring-sky-500 focus:outline-none text-xs"
                  >
                    <option value="operator">Operator</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">System Admin</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Account Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-white focus:ring-2 focus:ring-sky-500 focus:outline-none text-xs"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Farm / Facility Name</label>
                <input
                  type="text"
                  placeholder="e.g. Godavari Aqua Cluster Pond 2"
                  value={formData.facilityName}
                  onChange={(e) => setFormData({ ...formData, facilityName: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              {/* Assign Ponds Multi-Select Checklist */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 block">
                  Assign Pond Devices ({formData.assignedPondIds.length} Selected)
                </label>
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-2xl p-2 space-y-1 bg-slate-50">
                  {allPonds.map((p) => {
                    const isChecked = formData.assignedPondIds.includes(p.deviceId);
                    return (
                      <div
                        key={p.deviceId}
                        onClick={() => togglePondAssignment(p.deviceId)}
                        className={`p-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer text-xs ${
                          isChecked ? 'bg-sky-50 border border-sky-200' : 'bg-white hover:bg-slate-100 border border-slate-200/80'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-extrabold text-slate-800 block truncate">{p.name}</span>
                          <span className="font-mono text-[10px] text-slate-500">{p.deviceId}</span>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 ${
                            isChecked ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingUser(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold transition-colors cursor-pointer shadow-md"
                >
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div
            className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3 animate-in zoom-in-95 text-xs text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-black text-slate-900">Confirm User Deletion</h4>
            <p className="text-slate-500 leading-snug">
              Are you sure you want to delete user <strong className="text-slate-800">{deletingUser.name}</strong> ({deletingUser.email})? This will revoke access to all assigned ponds.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold cursor-pointer shadow-md"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
