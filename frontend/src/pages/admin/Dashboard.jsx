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
} from 'lucide-react';

export default function Dashboard() {
  const { token, user, role, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState('installation_checklists'); // default tab
  const [checklistSubView, setChecklistSubView] = useState({ type: 'list', id: null });
  const [stats, setStats] = useState(null);
  const [installationStats, setInstallationStats] = useState(null);
  const [feedback, setFeedback] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filter state
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

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsData, feedbackData, instStatsData] = await Promise.all([
        fetchAdminStats(token).catch(() => null),
        fetchAdminFeedback(token, filters).catch(() => ({ data: [], pagination: {} })),
        fetchInstallationStats(token).catch(() => null),
      ]);
      setStats(statsData);
      setFeedback(feedbackData);
      setInstallationStats(instStatsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync URL path with Active Tab and SubView
  useEffect(() => {
    const path = location.pathname;
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
    }
  }, [location.pathname]);

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

            {/* OPERATIONAL WORKSPACE PAGES (Single Admin Login Access) */}
            <button
              onClick={() => { setActiveTab('sales_workspace'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'sales_workspace'
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <Briefcase size={18} />
              Sales Workspace
            </button>

            <button
              onClick={() => { setActiveTab('technical_workspace'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'technical_workspace'
                  ? 'bg-purple-600 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <Wrench size={18} />
              Technical Workspace
            </button>

            <button
              onClick={() => { setActiveTab('store_workspace'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'store_workspace' || activeTab === 'inventory'
                  ? 'bg-amber-600 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <Store size={18} />
              Store Manager Workspace
            </button>

            <button
              onClick={() => { setActiveTab('quotation_generator'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'quotation_generator'
                  ? 'bg-white/15 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <FileText size={18} />
              Quotation Generator
            </button>

            <button
              onClick={() => { setActiveTab('quotation_history'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'quotation_history'
                  ? 'bg-white/15 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <History size={18} />
              Quotation History
            </button>

            {(role === 'SALES' || role === 'ADMIN') && (
              <button
                onClick={() => { setActiveTab('customers'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
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

            {role === 'ADMIN' && (
              <>
                <button
                  onClick={() => { setActiveTab('users'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === 'users'
                      ? 'bg-white/15 text-white shadow-sm font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <UserCheck size={18} />
                  Employee Accounts
                </button>

                <button
                  onClick={() => { setActiveTab('audit_logs'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === 'audit_logs'
                      ? 'bg-white/15 text-white shadow-sm font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Shield size={18} />
                  System Audit Logs
                </button>
              </>
            )}

            <button
              onClick={() => { setActiveTab('feedback'); navigate('/admin/dashboard'); setShowMobileSidebar(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'feedback'
                  ? 'bg-white/15 text-white shadow-sm font-semibold'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <BarChart3 size={18} />
              Customer Feedback
            </button>
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
        </header>

        <main className="p-4 lg:p-6">
          {activeTab === 'sales_workspace' && (
            <SalesWorkspace
              onSelectChecklist={(id) => {
                setActiveTab('installation_checklists');
                setChecklistSubView({ type: 'view', id });
                navigate(`/admin/installation-checklists/${id}`);
              }}
              onCreateChecklist={() => {
                setActiveTab('installation_checklists');
                setChecklistSubView({ type: 'create', id: null });
                navigate('/admin/installation-checklists/create');
              }}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
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
          {activeTab === 'quotation_generator' && <QuotationGenerator />}
          {activeTab === 'quotation_history' && <QuotationHistory />}

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
      </div>

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
