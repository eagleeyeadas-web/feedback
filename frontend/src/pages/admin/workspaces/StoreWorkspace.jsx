import { useState, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, ShieldCheck, AlertTriangle, ArrowRight, RefreshCw, Clock, Search } from 'lucide-react';
import InventoryManagement from '../InventoryManagement';

export default function StoreWorkspace({ onSelectChecklist }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'pending_issue', 'pending_verification'

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/installations', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setChecklists(data.checklists || []);
      }
    } catch (err) {
      console.error('Failed to load Store workspace data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const pendingIssueJobs = checklists.filter((c) => c.reconciliation_status === 'INITIATED' || c.installation_status === 'Assigned');
  const pendingVerifyJobs = checklists.filter((c) => c.reconciliation_status === 'PENDING_STORE_VERIFICATION' || c.reconciliation_status === 'SITE_WORK_COMPLETED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-amber-500/30 text-amber-200 rounded-md border border-amber-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="w-7 h-7 text-amber-400" /> Store Manager Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            Receive incoming stock batches, issue devices for approved installation jobs, physically verify returned devices, separate damaged stock, and reconcile inventory discrepancies.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-6">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'inventory' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <Package className="w-4 h-4" /> Stock Balances & Add Stock
        </button>
        <button
          onClick={() => setActiveTab('pending_issue')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'pending_issue' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <Clock className="w-4 h-4" /> Jobs Awaiting Issue ({pendingIssueJobs.length})
        </button>
        <button
          onClick={() => setActiveTab('pending_verification')}
          className={`pb-3 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'pending_verification' ? 'border-amber-600 text-amber-600' : 'border-transparent text-gray-500'
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> Returns Pending Physical Verification ({pendingVerifyJobs.length})
        </button>
      </div>

      {/* TAB 1: Inventory Management View */}
      {activeTab === 'inventory' && <InventoryManagement />}

      {/* TAB 2: Pending Stock Issue Jobs */}
      {activeTab === 'pending_issue' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Installation Jobs Awaiting Device Issue</h3>
            <span className="text-xs text-gray-500 font-medium">{pendingIssueJobs.length} pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Requested Device Type</th>
                  <th className="py-3 px-4">Requested Quantity</th>
                  <th className="py-3 px-4">Arrival Schedule</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingIssueJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      No jobs currently awaiting stock issuance.
                    </td>
                  </tr>
                ) : (
                  pendingIssueJobs.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-amber-800">{item.checklist_number}</td>
                      <td className="py-3 px-4 font-bold text-gray-900">{item.client_name}</td>
                      <td className="py-3 px-4 font-semibold text-gray-800">{item.device_type}</td>
                      <td className="py-3 px-4 font-bold text-blue-700">{item.number_of_devices} units</td>
                      <td className="py-3 px-4 text-gray-600">{item.expected_arrival_date} {item.expected_arrival_time}</td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => onSelectChecklist ? onSelectChecklist(item.id) : navigate(`/admin/installation-checklists/${item.id}`)}
                          className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1"
                        >
                          Issue Stock <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Returns Pending Physical Verification */}
      {activeTab === 'pending_verification' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Declared Returns Awaiting Store Verification</h3>
            <span className="text-xs text-gray-500 font-medium">{pendingVerifyJobs.length} pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Checklist No.</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Device Type</th>
                  <th className="py-3 px-4">Technician</th>
                  <th className="py-3 px-4">Reconciliation Status</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingVerifyJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      No returned devices currently awaiting store physical verification.
                    </td>
                  </tr>
                ) : (
                  pendingVerifyJobs.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-emerald-800">{item.checklist_number}</td>
                      <td className="py-3 px-4 font-bold text-gray-900">{item.client_name}</td>
                      <td className="py-3 px-4 font-semibold text-gray-800">{item.device_type}</td>
                      <td className="py-3 px-4 text-gray-700">{item.service_engineer}</td>
                      <td className="py-3 px-4 font-bold text-purple-700">{item.reconciliation_status}</td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => onSelectChecklist ? onSelectChecklist(item.id) : navigate(`/admin/installation-checklists/${item.id}`)}
                          className="text-xs font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
                        >
                          Verify Physical Return <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
