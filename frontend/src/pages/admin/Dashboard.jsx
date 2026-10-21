import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import QuotationGenerator from './QuotationGenerator';
import QuotationHistory from './QuotationHistory';
import InstallationChecklistList from './installation/InstallationChecklistList';
import InstallationChecklistForm from './installation/InstallationChecklistForm';
import InstallationChecklistDetails from './installation/InstallationChecklistDetails';
import CustomerManagement from './CustomerManagement';
import UserManagement from './UserManagement';
import AuditLogs from './AuditLogs';
import SalesWorkspace from './workspaces/SalesWorkspace';
import TechnicalWorkspace from './workspaces/TechnicalWorkspace';
import StoreWorkspace from './workspaces/StoreWorkspace';
import {
  fetchAdminStats,
  fetchAdminFeedback,
  downloadAdminPDF,
  exportCSV,
  exportQuotationCSV,
  fetchInstallationStats,
  fetchFeedbackDeletionPreview,
  deleteAdminFeedback,
  deleteAllAdminFeedback,
} from '../../lib/api';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Filter,
  LogOut,
  MessageSquare,
  Search,
  Star,
  AlertTriangle,
  Eye,
  X,
  Menu,
  FileText,
  History,
  PlusCircle,
  Wrench,
  Package,
  Users,
  UserCheck,
  Shield,
  Briefcase,
  Store,
  Trash2,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Check,
} from 'lucide-react';

import AccessDenied from '../../components/AccessDenied';
import PushNotificationManager from '../../components/notifications/PushNotificationManager';

const ROLE_PERMITTED_TABS = {
  SALES: [
    'sales_workspace',
  ],
  TECHNICAL: [
    'technical_workspace',
  ],
  STORE_MANAGER: [
    'store_workspace',
  ],
  ADMIN: [
    'sales_workspace',
    'technical_workspace',
    'store_workspace',
    'installation_checklists',
    'inventory',
    'quotation_generator',
    'quotation_history',
    'customers',
    'users',
    'audit_logs',
    'feedback',
  ],
  SUPER_ADMIN: [
    'sales_workspace',
    'technical_workspace',
    'store_workspace',
    'installation_checklists',
    'inventory',
    'quotation_generator',
    'quotation_history',
    'customers',
    'users',
    'audit_logs',
    'feedback',
  ],
};

const DEFAULT_WORKSPACE_BY_ROLE = {
  SALES: 'sales_workspace',
  TECHNICAL: 'technical_workspace',
  STORE_MANAGER: 'store_workspace',
  ADMIN: 'installation_checklists',
  SUPER_ADMIN: 'installation_checklists',
};

const TAB_RESOURCE_NAMES = {
  sales_workspace: 'Sales & Customer Intake Workspace',
  technical_workspace: 'Technical Team Job Workspace',
  store_workspace: 'Store Manager & Stock Workspace',
  inventory: 'Inventory & Device Movements',
  quotation_generator: 'Quotation Generator (PDF)',
  quotation_history: 'Quotation History & Records',
  customers: 'Customer Records',
  users: 'Employee Account Management',
  audit_logs: 'System Audit Trail',
  feedback: 'Customer Feedback Management',
  installation_checklists: 'Installation Checklist Workflow',
};

export default function Dashboard() {
  const { token, user, role, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const userRole = (role || 'ADMIN').toUpperCase();
  const allowedTabs = ROLE_PERMITTED_TABS[userRole] || ROLE_PERMITTED_TABS.ADMIN;
  const defaultTab = DEFAULT_WORKSPACE_BY_ROLE[userRole] || 'installation_checklists';

  const [activeTab, setActiveTab] = useState(defaultTab);
  const [checklistSubView, setChecklistSubView] = useState({ type: 'list', id: null });
  const [salesSubView, setSalesSubView] = useState(null);
  const [stats, setStats] = useState(null);
  const [installationStats, setInstallationStats] = useState(null);
  const [feedback, setFeedback] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filters, setFilters] = useState({
    search: '',
    dateFrom: '',
    dateTo: '',
    product: '',
    technician: '',
    rating: '',
    resolution: '',
    page: 1,
    limit: 15,
  });

  // Feedback Deletion States
  const [deleteSingleModal, setDeleteSingleModal] = useState({ open: false, item: null, submitting: false, error: '' });
  const [deleteAllModal, setDeleteAllModal] = useState({
    open: false,
    scope: 'TEST',
    preview: null,
    loading: false,
    confirmedCountInput: '',
    submitting: false,
    error: '',
    result: null,
  });
  const [feedbackToast, setFeedbackToast] = useState('');

  const showFeedbackToast = (msg) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(''), 4000);
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    // Only load feedback table and stats when active tab is actually 'feedback'
    if (activeTab !== 'feedback') {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [statsData, feedbackData] = await Promise.all([
        fetchAdminStats(token).catch(() => null),
        fetchAdminFeedback(token, filters).catch(() => ({ data: [], pagination: {} })),
      ]);
      setStats(statsData);
      setFeedback(feedbackData);
    } catch (err) {
      console.error('Failed to load feedback data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, filters, activeTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync URL path and query parameters with Active Tab and SubView
  useEffect(() => {
    const path = location.pathname;
    const searchParams = new URLSearchParams(location.search);
    const queryTab = searchParams.get('tab');

    if (path.startsWith('/admin/installation-checklists')) {
      setActiveTab('installation_checklists');
      if (path === '/admin/installation-checklists/create') {
        setChecklistSubView({ type: 'create', id: null });
      } else if (path.endsWith('/edit')) {
        const parts = path.split('/');
        const id = parts[parts.length - 2];
        setChecklistSubView({ type: 'edit', id });
      } else {
        const parts = path.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart !== 'installation-checklists' && lastPart) {
          setChecklistSubView({ type: 'view', id: lastPart });
        } else {
          setChecklistSubView({ type: 'list', id: null });
        }
      }
    } else if (queryTab) {
      setActiveTab(queryTab);
    } else if (path === '/admin/dashboard' || path === '/admin') {
      setActiveTab(defaultTab);
    }
  }, [location.pathname, location.search, defaultTab]);

  const handleSearch = (e) => {
    e.preventDefault();
    setFilters((f) => ({ ...f, page: 1 }));
  };

  const handleExportCSV = async () => {
    try {
      const blob = await exportCSV(token, filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback_export_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleExportQuotationCSV = async () => {
    try {
      const blob = await exportQuotationCSV(token);
      const todayStr = new Date().toISOString().split('T')[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Eagle_Eye_Quotations_${todayStr}.csv`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Quotation export failed:', err);
      alert(err.message || 'Failed to export quotation CSV');
    }
  };

  const handleDownloadPDF = async (id) => {
    try {
      const blob = await downloadAdminPDF(token, id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback_${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed:', err);
    }
  };

  // Feedback Deletion Handlers
  const handleOpenDeleteAllFeedback = async (initialScope = 'TEST') => {
    setDeleteAllModal({
      open: true,
      scope: initialScope,
      preview: null,
      loading: true,
      confirmedCountInput: '',
      submitting: false,
      error: '',
      result: null,
    });
    try {
      const preview = await fetchFeedbackDeletionPreview(token, { scope: initialScope, search: filters.search });
      setDeleteAllModal((prev) => ({
        ...prev,
        preview,
        loading: false,
      }));
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to evaluate feedback records for deletion',
      }));
    }
  };

  const handleChangeDeleteScope = async (newScope) => {
    setDeleteAllModal((prev) => ({
      ...prev,
      scope: newScope,
      loading: true,
      confirmedCountInput: '',
      error: '',
    }));
    try {
      const preview = await fetchFeedbackDeletionPreview(token, { scope: newScope, search: filters.search });
      setDeleteAllModal((prev) => ({
        ...prev,
        preview,
        loading: false,
      }));
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to update deletion preview',
      }));
    }
  };

  const handleConfirmDeleteAllFeedback = async () => {
    const { scope, preview, confirmedCountInput } = deleteAllModal;
    const eligibleCount = preview?.eligibleCount || 0;

    if (eligibleCount > 0 && String(confirmedCountInput).trim() !== String(eligibleCount)) {
      setDeleteAllModal((prev) => ({
        ...prev,
        error: `Please enter exact count "${eligibleCount}" in the confirmation box to proceed safely.`,
      }));
      return;
    }

    setDeleteAllModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      const res = await deleteAllAdminFeedback(token, {
        scope,
        confirmedCount: eligibleCount,
        search: filters.search,
      });
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        result: res,
      }));
      showFeedbackToast(res.message || `Deleted ${res.deletedCount} feedback records.`);
      loadData();
    } catch (err) {
      setDeleteAllModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to execute bulk deletion',
      }));
    }
  };

  const handleDeleteSingleFeedback = (item) => {
    setDeleteSingleModal({
      open: true,
      item,
      submitting: false,
      error: '',
    });
  };

  const handleConfirmDeleteSingleFeedback = async () => {
    if (!deleteSingleModal.item) return;
    setDeleteSingleModal((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      await deleteAdminFeedback(token, deleteSingleModal.item.id);
      showFeedbackToast(`Feedback ${deleteSingleModal.item.feedback_id} deleted successfully.`);
      setDeleteSingleModal({ open: false, item: null, submitting: false, error: '' });
      loadData();
    } catch (err) {
      setDeleteSingleModal((prev) => ({
        ...prev,
        submitting: false,
        error: err.message || 'Failed to delete feedback record',
      }));
    }
  };

  const handleViewDetail = async (item) => {
    setSelectedFeedback(item);
    setDetailLoading(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/admin/login');
  };

  const { pagination } = feedback;

  const roleLabels = {
    ADMIN: 'Administrator',
    SALES: 'Sales Executive',
    TECHNICAL: 'Service Engineer',
    STORE_MANAGER: 'Store Manager',
  };

  const roleColors = {
    ADMIN: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
    SALES: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
    TECHNICAL: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    STORE_MANAGER: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile sidebar overlay */}
      {showMobileSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-navy text-white
          transform transition-transform duration-300 lg:transform-none flex flex-col justify-between
          ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div>
          <div className="p-5 border-b border-white/10">
            <h2 className="font-bold text-lg">Eagle Eye Safdrive</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${roleColors[role] || 'bg-white/10 text-white/80'}`}>
                {role}
              </span>
              <span className="text-xs text-white/50 truncate">
                {roleLabels[role] || role}
              </span>
            </div>
          </div>
          <nav className="p-4 space-y-1">
            {/* Permitted Workspace Tabs */}
            {allowedTabs.includes('sales_workspace') && (
              <button
                onClick={() => { setActiveTab('sales_workspace'); navigate('/admin/dashboard?tab=sales_workspace'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'sales_workspace'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Briefcase size={18} />
                Sales Workspace
              </button>
            )}

            {allowedTabs.includes('technical_workspace') && (
              <button
                onClick={() => { setActiveTab('technical_workspace'); navigate('/admin/dashboard?tab=technical_workspace'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'technical_workspace'
                    ? 'bg-purple-600 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Wrench size={18} />
                Technical Workspace
              </button>
            )}

            {allowedTabs.includes('store_workspace') && (
              <button
                onClick={() => { setActiveTab('store_workspace'); navigate('/admin/dashboard?tab=store_workspace'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'store_workspace' || activeTab === 'inventory'
                    ? 'bg-amber-600 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Store size={18} />
                Store Manager Workspace
              </button>
            )}

            {allowedTabs.includes('installation_checklists') && (
              <button
                onClick={() => {
                  setActiveTab('installation_checklists');
                  setChecklistSubView({ type: 'list', id: null });
                  navigate('/admin/installation-checklists');
                  setShowMobileSidebar(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'installation_checklists'
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Wrench size={18} />
                Installation Jobs
              </button>
            )}

            {allowedTabs.includes('quotation_generator') && (
              <button
                onClick={() => { setActiveTab('quotation_generator'); navigate('/admin/dashboard?tab=quotation_generator'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'quotation_generator'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <FileText size={18} />
                Quotation Generator
              </button>
            )}

            {allowedTabs.includes('quotation_history') && (
              <button
                onClick={() => { setActiveTab('quotation_history'); navigate('/admin/dashboard?tab=quotation_history'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'quotation_history'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <History size={18} />
                Quotation History
              </button>
            )}

            {allowedTabs.includes('customers') && (
              <button
                onClick={() => { setActiveTab('customers'); navigate('/admin/dashboard?tab=customers'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'customers'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Users size={18} />
                Customer Directory
              </button>
            )}

            {allowedTabs.includes('users') && (
              <button
                onClick={() => { setActiveTab('users'); navigate('/admin/dashboard?tab=users'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'users'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <UserCheck size={18} />
                Employee Accounts
              </button>
            )}

            {allowedTabs.includes('audit_logs') && (
              <button
                onClick={() => { setActiveTab('audit_logs'); navigate('/admin/dashboard?tab=audit_logs'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'audit_logs'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Shield size={18} />
                System Audit Logs
              </button>
            )}

            {allowedTabs.includes('feedback') && (
              <button
                onClick={() => { setActiveTab('feedback'); navigate('/admin/dashboard?tab=feedback'); setShowMobileSidebar(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === 'feedback'
                    ? 'bg-white/15 text-white shadow-sm font-semibold'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <BarChart3 size={18} />
                Customer Feedback
              </button>
            )}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="text-xs font-semibold text-white/90 truncate">{profile?.full_name || user?.email}</div>
          <div className="text-[11px] text-white/50 truncate mb-3">{user?.email}</div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMobileSidebar(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-lg font-bold text-navy">
              {activeTab === 'sales_workspace' && 'Sales & Customer Intake Workspace'}
              {activeTab === 'technical_workspace' && 'Technical Team Job Workspace'}
              {activeTab === 'store_workspace' && 'Store Manager & Stock Workspace'}
              {activeTab === 'installation_checklists' && 'Installation Checklist Workflow'}
              {activeTab === 'inventory' && 'Inventory & Device Movements'}
              {activeTab === 'customers' && 'Customer Records'}
              {activeTab === 'users' && 'Employee Account Management'}
              {activeTab === 'audit_logs' && 'System Audit Trail'}
              {activeTab === 'feedback' && 'Customer Feedback Management'}
              {activeTab === 'quotation_generator' && 'Quotation Generator (PDF)'}
              {activeTab === 'quotation_history' && 'Quotation History & Records'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <PushNotificationManager />
          </div>
        </header>

        {/* Role Access Authorization Check */}
        {(() => {
          const isTabAllowed = allowedTabs.includes(activeTab);
          const canCreateOrEditJob = userRole === 'SALES' || userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
          const isSubViewDenied =
            activeTab === 'installation_checklists' &&
            ((checklistSubView.type === 'create' && !canCreateOrEditJob) ||
             (checklistSubView.type === 'edit' && !canCreateOrEditJob));

          const isAccessDenied = !isTabAllowed || isSubViewDenied;
          const deniedResourceName = isSubViewDenied
            ? (checklistSubView.type === 'create' ? 'Create Installation Job' : 'Edit Installation Job')
            : (TAB_RESOURCE_NAMES[activeTab] || activeTab);

          if (isAccessDenied) {
            return (
              <main className="p-4 lg:p-6">
                <AccessDenied
                  targetResource={deniedResourceName}
                  onNavigateDefault={(tab) => {
                    setActiveTab(tab);
                    setChecklistSubView({ type: 'list', id: null });
                    navigate(`/admin/dashboard?tab=${tab}`);
                  }}
                />
              </main>
            );
          }

          return null;
        })()}

        {(() => {
          const isTabAllowed = allowedTabs.includes(activeTab);
          const canCreateOrEditJob = userRole === 'SALES' || userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
          const isSubViewDenied =
            activeTab === 'installation_checklists' &&
            ((checklistSubView.type === 'create' && !canCreateOrEditJob) ||
             (checklistSubView.type === 'edit' && !canCreateOrEditJob));

          if (!isTabAllowed || isSubViewDenied) {
            return null;
          }

          return (
            <main className="p-4 lg:p-6">
              {activeTab === 'sales_workspace' && (
                <div>
                  {salesSubView?.type === 'create' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                        <button
                          onClick={() => setSalesSubView(null)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                        >
                          <ChevronLeft size={16} /> Back to Sales Workspace
                        </button>
                        <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                          New Installation Checklist
                        </span>
                      </div>
                      <InstallationChecklistForm
                        onSaved={(id) => setSalesSubView({ type: 'view', id })}
                        onCancel={() => setSalesSubView(null)}
                      />
                    </div>
                  )}

                  {salesSubView?.type === 'edit' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                        <button
                          onClick={() => setSalesSubView(null)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                        >
                          <ChevronLeft size={16} /> Back to Sales Workspace
                        </button>
                        <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                          Edit Installation Checklist
                        </span>
                      </div>
                      <InstallationChecklistForm
                        id={salesSubView.id}
                        onSaved={(id) => setSalesSubView({ type: 'view', id })}
                        onCancel={() => setSalesSubView(null)}
                      />
                    </div>
                  )}

                  {salesSubView?.type === 'view' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                        <button
                          onClick={() => setSalesSubView(null)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-navy bg-white hover:bg-gray-50 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                        >
                          <ChevronLeft size={16} /> Back to Sales Workspace
                        </button>
                        <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                          Checklist Details
                        </span>
                      </div>
                      <InstallationChecklistDetails
                        id={salesSubView.id}
                        onEdit={(id) => setSalesSubView({ type: 'edit', id })}
                        onBack={() => setSalesSubView(null)}
                      />
                    </div>
                  )}

                  {!salesSubView && (
                    <SalesWorkspace
                      onSelectChecklist={(id) => setSalesSubView({ type: 'view', id })}
                      onCreateChecklist={() => setSalesSubView({ type: 'create', id: null })}
                      onNavigateTab={(tab) => {
                        if (allowedTabs.includes(tab)) {
                          setActiveTab(tab);
                          navigate(`/admin/dashboard?tab=${tab}`);
                        }
                      }}
                    />
                  )}
                </div>
              )}
          {activeTab === 'technical_workspace' && (
            <TechnicalWorkspace
              onSelectChecklist={(id) => {
                setActiveTab('installation_checklists');
                setChecklistSubView({ type: 'view', id });
                navigate(`/admin/installation-checklists/${id}`);
              }}
            />
          )}
          {(activeTab === 'store_workspace' || activeTab === 'inventory') && (
            <StoreWorkspace
              onSelectChecklist={(id) => {
                setActiveTab('installation_checklists');
                setChecklistSubView({ type: 'view', id });
                navigate(`/admin/installation-checklists/${id}`);
              }}
            />
          )}
          {activeTab === 'customers' && <CustomerManagement />}
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'audit_logs' && <AuditLogs />}
          {activeTab === 'quotation_generator' && (
            <QuotationGenerator
              onNavigateToHistory={() => setActiveTab('quotation_history')}
            />
          )}
          {activeTab === 'quotation_history' && (
            <QuotationHistory
              onNavigateToGenerator={() => setActiveTab('quotation_generator')}
            />
          )}

          {activeTab === 'installation_checklists' && (
            <div>
              {checklistSubView.type === 'list' && (
                <InstallationChecklistList
                  onSelectChecklist={(id, mode) => {
                    if (mode === 'edit') {
                      setChecklistSubView({ type: 'edit', id });
                      navigate(`/admin/installation-checklists/${id}/edit`);
                    } else if (mode === 'download') {
                      setChecklistSubView({ type: 'view', id });
                      navigate(`/admin/installation-checklists/${id}?action=download`);
                    } else if (mode === 'print') {
                      setChecklistSubView({ type: 'view', id });
                      navigate(`/admin/installation-checklists/${id}?action=print`);
                    } else {
                      setChecklistSubView({ type: 'view', id });
                      navigate(`/admin/installation-checklists/${id}`);
                    }
                  }}
                  onCreateNew={() => {
                    setChecklistSubView({ type: 'create', id: null });
                    navigate('/admin/installation-checklists/create');
                  }}
                />
              )}

              {checklistSubView.type === 'create' && (
                <InstallationChecklistForm
                  onSaved={(id) => {
                    setChecklistSubView({ type: 'view', id });
                    navigate(`/admin/installation-checklists/${id}`);
                  }}
                  onCancel={() => {
                    setChecklistSubView({ type: 'list', id: null });
                    navigate('/admin/installation-checklists');
                  }}
                />
              )}

              {checklistSubView.type === 'edit' && (
                <InstallationChecklistForm
                  id={checklistSubView.id}
                  onSaved={(id) => {
                    setChecklistSubView({ type: 'view', id });
                    navigate(`/admin/installation-checklists/${id}`);
                  }}
                  onCancel={() => {
                    setChecklistSubView({ type: 'list', id: null });
                    navigate('/admin/installation-checklists');
                  }}
                />
              )}

              {checklistSubView.type === 'view' && (
                <InstallationChecklistDetails
                  id={checklistSubView.id}
                  onEdit={(id) => {
                    setChecklistSubView({ type: 'edit', id });
                    navigate(`/admin/installation-checklists/${id}/edit`);
                  }}
                  onBack={() => {
                    setChecklistSubView({ type: 'list', id: null });
                    navigate('/admin/installation-checklists');
                  }}
                />
              )}
            </div>
          )}

          {activeTab === 'feedback' && (
            <>
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <MessageSquare size={16} className="text-blue-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.totalSubmissions}</p>
                <p className="text-xs text-gray-500">Total Submissions</p>
              </div>

              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                    <CalendarDays size={16} className="text-green-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.todaySubmissions}</p>
                <p className="text-xs text-gray-500">Today</p>
              </div>

              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Star size={16} className="text-amber-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.averageRating}</p>
                <p className="text-xs text-gray-500">Avg Rating</p>
              </div>

              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                    <AlertTriangle size={16} className="text-red-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-gray-900">{stats.unresolvedCount}</p>
                <p className="text-xs text-gray-500">Unresolved</p>
              </div>
            </div>
          )}

          {/* Search & Filters */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="p-4 flex flex-col sm:flex-row gap-3">
              <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, phone, IMEI, vehicle, or feedback ID..."
                    value={filters.search}
                    onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                    className="form-input pl-9"
                  />
                </div>
                <button type="submit" className="px-4 py-2 bg-navy text-white text-sm rounded-lg font-medium hover:bg-navy-light transition-colors cursor-pointer">
                  Search
                </button>
              </form>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer
                  ${showFilters ? 'bg-navy text-white border-navy' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                <Filter size={16} />
                Filters
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer shadow-xs"
                title="Export customer feedback records to CSV"
              >
                <FileDown size={16} />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                id="delete-all-feedback-btn"
                onClick={() => handleOpenDeleteAllFeedback('TEST')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-300 transition-colors cursor-pointer shadow-xs"
                title="Delete test feedback records or bulk cleanup"
              >
                <Trash2 size={16} />
                <span>Delete All / Clean Test Feedback</span>
              </button>
            </div>

            {/* Expanded Filters */}
            {showFilters && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-100 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 animate-fade-in">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Date From</label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value, page: 1 }))}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Date To</label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value, page: 1 }))}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Product</label>
                  <input
                    type="text"
                    placeholder="Filter by product"
                    value={filters.product}
                    onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value, page: 1 }))}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Technician</label>
                  <input
                    type="text"
                    placeholder="Filter by technician"
                    value={filters.technician}
                    onChange={(e) => setFilters((f) => ({ ...f, technician: e.target.value, page: 1 }))}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Resolution</label>
                  <select
                    value={filters.resolution}
                    onChange={(e) => setFilters((f) => ({ ...f, resolution: e.target.value, page: 1 }))}
                    className="form-input text-xs"
                  >
                    <option value="">All</option>
                    <option value="Yes">Yes</option>
                    <option value="Partially">Partially</option>
                    <option value="No">No</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Feedback Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Feedback ID</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th className="hidden md:table-cell">IMEI</th>
                    <th className="hidden lg:table-cell">Product</th>
                    <th>Rating</th>
                    <th className="hidden sm:table-cell">Resolved</th>
                    <th className="hidden lg:table-cell">Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-gray-400">
                        Loading...
                      </td>
                    </tr>
                  ) : feedback.data.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-gray-400">
                        No feedback records found
                      </td>
                    </tr>
                  ) : (
                    feedback.data.map((item) => (
                      <tr key={item.id}>
                        <td className="font-mono text-xs font-semibold text-navy">
                          {item.feedback_id}
                        </td>
                        <td className="font-medium">{item.customer_name}</td>
                        <td className="text-xs">{item.phone_number}</td>
                        <td className="hidden md:table-cell text-xs font-mono">{item.imei_number}</td>
                        <td className="hidden lg:table-cell text-xs">{item.product_service}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <Star size={14} className="text-gold fill-gold" />
                            <span className="text-sm font-semibold">{item.average_rating}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium
                              ${item.issue_resolved === 'Yes'
                                ? 'bg-green-50 text-green-700'
                                : item.issue_resolved === 'Partially'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                              }`}
                          >
                            {item.issue_resolved}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell text-xs text-gray-500">
                          {new Date(item.submitted_at).toLocaleDateString('en-IN')}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleViewDetail(item)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors cursor-pointer"
                              title="View details"
                            >
                              <Eye size={16} />
                            </button>
                            {(!item.pdf_path || (item.pdf_expires_at && new Date(item.pdf_expires_at) <= new Date())) ? (
                              <span
                                className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none"
                                title="PDF expired after 20-day retention window"
                              >
                                PDF Expired
                              </span>
                            ) : (
                              <button
                                onClick={() => handleDownloadPDF(item.feedback_id)}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-navy transition-colors cursor-pointer"
                                title="Download PDF"
                              >
                                <Download size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteSingleFeedback(item)}
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-gray-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Delete feedback record"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                    disabled={pagination.page <= 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                    disabled={pagination.page >= pagination.totalPages}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </main>
      );
    })()}
      </div>

      {/* Toast Notification */}
      {feedbackToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-navy text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span>{feedbackToast}</span>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Delete Single Feedback Record Modal                  */}
      {/* ---------------------------------------------------- */}
      {deleteSingleModal.open && deleteSingleModal.item && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                  <Trash2 size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Delete Feedback Record</h3>
                  <p className="text-[11px] text-gray-500">Customer Feedback Management</p>
                </div>
              </div>
              <button
                disabled={deleteSingleModal.submitting}
                onClick={() => setDeleteSingleModal({ open: false, item: null, submitting: false, error: '' })}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Feedback ID:</span>
                <span className="font-mono font-bold text-navy">{deleteSingleModal.item.feedback_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Customer Name:</span>
                <span className="font-bold text-gray-800">{deleteSingleModal.item.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Mobile Number:</span>
                <span className="font-mono text-gray-700">{deleteSingleModal.item.phone_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Product / Service:</span>
                <span className="text-gray-700">{deleteSingleModal.item.product_service}</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] leading-relaxed">
              <strong>Confirmation:</strong> This customer submission and its stored PDF/signature files will be permanently deleted from the database.
            </div>

            {deleteSingleModal.error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {deleteSingleModal.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteSingleModal.submitting}
                onClick={() => setDeleteSingleModal({ open: false, item: null, submitting: false, error: '' })}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteSingleModal.submitting}
                onClick={handleConfirmDeleteSingleFeedback}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 shadow-xs"
              >
                {deleteSingleModal.submitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* Delete All / Bulk Feedback Modal                     */}
      {/* ---------------------------------------------------- */}
      {deleteAllModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-100 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-navy flex items-center gap-2">
                    <span>Clean Feedback Records</span>
                    <span className="text-[11px] font-semibold bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full">
                      Customer Feedback Management
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Clear test feedback submissions or clean records directly without modifying Supabase tables.
                  </p>
                </div>
              </div>
              <button
                disabled={deleteAllModal.submitting}
                onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {deleteAllModal.loading ? (
              <div className="py-12 text-center space-y-2">
                <Loader2 size={32} className="animate-spin text-blue-600 mx-auto" />
                <p className="text-xs font-semibold text-gray-700">Evaluating feedback records...</p>
              </div>
            ) : deleteAllModal.result ? (
              /* Results */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    <span>Feedback Cleanup Completed</span>
                  </div>
                  <p className="text-xs text-emerald-700 mt-1">{deleteAllModal.result.message}</p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                    <span className="text-[11px] text-emerald-700 font-semibold uppercase block">Deleted</span>
                    <span className="text-xl font-bold text-emerald-900">{deleteAllModal.result.deletedCount}</span>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Preserved / Skipped</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.result.skippedCount}</span>
                  </div>
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Failed</span>
                    <span className="text-xl font-bold text-gray-700">{deleteAllModal.result.failedCount}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Scope selection and confirmation */
              <div className="space-y-4">
                {/* 3-card stats */}
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase block">Total Feedback</span>
                    <span className="text-xl font-bold text-gray-900">{deleteAllModal.preview?.totalCount || 0}</span>
                  </div>
                  <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
                    <span className="text-[11px] text-rose-700 font-semibold uppercase block">Eligible to Delete</span>
                    <span className="text-xl font-bold text-rose-900">{deleteAllModal.preview?.eligibleCount || 0}</span>
                  </div>
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl">
                    <span className="text-[11px] text-blue-700 font-semibold uppercase block">Preserved / Kept</span>
                    <span className="text-xl font-bold text-blue-900">{deleteAllModal.preview?.protectedCount || 0}</span>
                  </div>
                </div>

                {/* Scope Radio Selection */}
                <div className="space-y-2 text-xs">
                  <span className="font-bold text-gray-800 block">Select Deletion Scope:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                      deleteAllModal.scope === 'TEST' ? 'border-rose-400 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input
                        type="radio"
                        name="feedbackScope"
                        value="TEST"
                        checked={deleteAllModal.scope === 'TEST'}
                        onChange={() => handleChangeDeleteScope('TEST')}
                        className="mt-0.5 text-rose-600 focus:ring-rose-500"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block">Delete Test Feedback Only</span>
                        <span className="text-[11px] text-gray-500">
                          Identifies records marked with test keywords (test, demo, sample). Protects real client feedback.
                        </span>
                      </div>
                    </label>

                    <label className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                      deleteAllModal.scope === 'ALL' ? 'border-rose-400 bg-rose-50/50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input
                        type="radio"
                        name="feedbackScope"
                        value="ALL"
                        checked={deleteAllModal.scope === 'ALL'}
                        onChange={() => handleChangeDeleteScope('ALL')}
                        className="mt-0.5 text-rose-600 focus:ring-rose-500"
                      />
                      <div>
                        <span className="font-bold text-gray-900 block">Delete All Records</span>
                        <span className="text-[11px] text-gray-500">
                          Clears all {deleteAllModal.preview?.totalCount || 0} feedback submissions in this table.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Sample records to be deleted */}
                {deleteAllModal.preview?.eligibleRecords && deleteAllModal.preview.eligibleRecords.length > 0 && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-700 block mb-1.5">
                      Records to be deleted ({deleteAllModal.preview.eligibleCount}):
                    </span>
                    <div className="max-h-32 overflow-y-auto p-2.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1 font-mono text-[11px]">
                      {deleteAllModal.preview.eligibleRecords.slice(0, 10).map((r) => (
                        <div key={r.id} className="flex justify-between text-gray-700">
                          <span>{r.feedback_id} — {r.customer_name}</span>
                          <span className="text-gray-400">{r.phone_number}</span>
                        </div>
                      ))}
                      {deleteAllModal.preview.eligibleCount > 10 && (
                        <div className="text-gray-400 italic">...and {deleteAllModal.preview.eligibleCount - 10} more records</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Required confirmation input */}
                {(deleteAllModal.preview?.eligibleCount || 0) > 0 ? (
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-2">
                    <span className="font-bold text-amber-900 block">
                      Type <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-300">{deleteAllModal.preview?.eligibleCount}</span> to confirm deletion:
                    </span>
                    <input
                      type="text"
                      value={deleteAllModal.confirmedCountInput}
                      onChange={(e) => setDeleteAllModal((prev) => ({ ...prev, confirmedCountInput: e.target.value }))}
                      placeholder={`Enter ${deleteAllModal.preview?.eligibleCount}`}
                      className="w-full px-3 py-2 bg-white rounded-lg border border-amber-300 text-xs font-mono font-bold text-gray-800"
                    />
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs text-gray-500">
                    No records match the selected scope for deletion.
                  </div>
                )}

                {deleteAllModal.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-semibold">
                    {deleteAllModal.error}
                  </div>
                )}

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    disabled={deleteAllModal.submitting}
                    onClick={() => setDeleteAllModal((prev) => ({ ...prev, open: false }))}
                    className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      deleteAllModal.submitting ||
                      !deleteAllModal.preview?.eligibleCount ||
                      String(deleteAllModal.confirmedCountInput).trim() !== String(deleteAllModal.preview?.eligibleCount)
                    }
                    onClick={handleConfirmDeleteAllFeedback}
                    className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    {deleteAllModal.submitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Deleting Records...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        <span>Confirm Delete ({deleteAllModal.preview?.eligibleCount || 0})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedFeedback && (
        <FeedbackDetailDrawer
          feedback={selectedFeedback}
          onClose={() => setSelectedFeedback(null)}
          onDownloadPDF={() => handleDownloadPDF(selectedFeedback.feedback_id)}
        />
      )}
    </div>
  );
}

/* ============================================================
   Feedback Detail Drawer Component
   ============================================================ */

function FeedbackDetailDrawer({ feedback, onClose, onDownloadPDF }) {
  const f = feedback;
  const submittedDate = new Date(f.submitted_at);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl overflow-y-auto custom-scrollbar animate-fade-in">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-bold text-navy">{f.feedback_id}</h3>
            <p className="text-xs text-gray-400">
              {submittedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' '}at{' '}
              {submittedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(!f.pdf_path || (f.pdf_expires_at && new Date(f.pdf_expires_at) <= new Date())) ? (
              <span
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none"
                title="PDF expired after 20-day retention window"
              >
                PDF Expired
              </span>
            ) : (
              <button onClick={onDownloadPDF} className="btn-secondary flex items-center gap-1.5 cursor-pointer">
                <Download size={14} /> PDF
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Customer Details */}
          <DetailSection title="Customer Details">
            <DetailRow label="Name" value={f.customer_name} />
            <DetailRow label="Phone" value={f.phone_number} />
            <DetailRow label="Company" value={f.company_name || '-'} />
            <DetailRow label="Email" value={f.email || '-'} />
          </DetailSection>

          {/* Vehicle Details */}
          <DetailSection title="Vehicle Details">
            <DetailRow label="Vehicle No." value={f.vehicle_number || '-'} />
            <DetailRow label="IMEI" value={f.imei_number} mono />
            <DetailRow label="Vehicle Type" value={f.vehicle_type} />
          </DetailSection>

          {/* Service Details */}
          <DetailSection title="Service Details">
            <DetailRow label="Product/Service" value={f.product_service} />
            <DetailRow label="Service Date" value={new Date(f.service_date).toLocaleDateString('en-IN')} />
            <DetailRow label="Technician" value={f.technician} />
          </DetailSection>

          {/* Ratings */}
          <DetailSection title="Ratings">
            <RatingRow label="Product Quality" value={f.rating_product_quality} />
            <RatingRow label="Installation" value={f.rating_installation} />
            <RatingRow label="Performance" value={f.rating_performance} />
            <RatingRow label="Professionalism" value={f.rating_professionalism} />
            <RatingRow label="Support" value={f.rating_support} />
            <div className="pt-2 mt-2 border-t border-gray-100 flex justify-between">
              <span className="text-sm font-bold text-navy">Average</span>
              <span className="text-sm font-bold text-red-accent">{f.average_rating} / 5.0</span>
            </div>
          </DetailSection>

          {/* Resolution */}
          <DetailSection title="Issue Resolution">
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-medium
                ${f.issue_resolved === 'Yes'
                  ? 'bg-green-50 text-green-700'
                  : f.issue_resolved === 'Partially'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700'
                }`}
            >
              {f.issue_resolved}
            </span>
          </DetailSection>

          {/* Comments */}
          {f.improvement_suggestions && (
            <DetailSection title="Improvement Suggestions">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{f.improvement_suggestions}</p>
            </DetailSection>
          )}

          {f.additional_comments && (
            <DetailSection title="Additional Comments">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{f.additional_comments}</p>
            </DetailSection>
          )}

          {/* Signature */}
          {f.signature_url && (
            <DetailSection title="Digital Signature">
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <img src={f.signature_url} alt="Customer signature" className="max-h-24 mx-auto" />
              </div>
            </DetailSection>
          )}
        </div>
      </div>
    </>
  );
}

function DetailSection({ title, children }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium text-gray-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function RatingRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={14}
            className={i <= value ? 'text-gold fill-gold' : 'text-gray-200'}
          />
        ))}
        <span className="text-xs font-semibold text-gray-600 ml-1">{value}/5</span>
      </div>
    </div>
  );
}
