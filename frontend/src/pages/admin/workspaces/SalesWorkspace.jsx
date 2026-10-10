import { useState, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Wrench, FileText, Calendar, CreditCard, ArrowRight, Search, CheckCircle2 } from 'lucide-react';

export default function SalesWorkspace({ onSelectChecklist, onCreateChecklist, onNavigateTab }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [checkRes, custRes] = await Promise.all([
        fetch('/api/admin/installations', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/customers?limit=5', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (checkRes.ok) {
        const cData = await checkRes.json();
        setChecklists(cData.checklists || []);
      }
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomers(custData.customers || []);
      }
    } catch (err) {
      console.error('Failed to load Sales workspace data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const filteredChecklists = checklists.filter((c) =>
    (c.client_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.checklist_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.client_location || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="bg-gradient-to-r from-blue-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-blue-500/30 text-blue-200 rounded-md border border-blue-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Users className="w-7 h-7 text-blue-400" /> Sales & Customer Intake Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            Create customer records, initiate installation checklists with original client requirements, manage quotations, schedule arrival dates, and monitor job progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onCreateChecklist ? onCreateChecklist() : navigate('/admin/installation-checklists/create')}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Installation Checklist
          </button>
          <button
            onClick={() => onNavigateTab ? onNavigateTab('quotation_generator') : null}
            className="px-4 py-2 text-xs font-bold text-navy bg-white rounded-xl hover:bg-gray-100 flex items-center gap-2 shadow-sm transition-all"
          >
            <FileText className="w-4 h-4 text-blue-600" /> Generate Quotation
          </button>
        </div>
      </div>

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Wrench className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Total Checklists</p>
            <p className="text-xl font-bold text-gray-900">{checklists.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Pending & Assigned</p>
            <p className="text-xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'Pending' || c.installation_status === 'Assigned').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Completed Jobs</p>
            <p className="text-xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'Completed' || c.installation_status === 'Site Work Completed').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] text-gray-500 font-medium">Customer Profiles</p>
            <p className="text-xl font-bold text-gray-900">{customers.length}</p>
          </div>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter Sales checklists by client name, checklist number, or location..."
          className="w-full text-xs bg-transparent border-none outline-none text-gray-800 placeholder-gray-400"
        />
      </div>

      {/* Sales Job Checklists Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Sales Initiated Installation Checklists</h3>
          <span className="text-xs text-gray-500 font-medium">Showing {filteredChecklists.length} jobs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">Checklist No.</th>
                <th className="py-3 px-4">Client Name & Mobile</th>
                <th className="py-3 px-4">Device Requested</th>
                <th className="py-3 px-4">Vehicles</th>
                <th className="py-3 px-4">Confirmed Price</th>
                <th className="py-3 px-4">Expected Arrival</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">Loading Sales job checklists...</td>
                </tr>
              ) : filteredChecklists.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">No matching Sales checklists found.</td>
                </tr>
              ) : (
                filteredChecklists.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-700">{item.checklist_number}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900">{item.client_name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{item.client_mobile}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-gray-800">{item.device_type}</span>
                      <div className="text-[10px] text-gray-400">Qty: {item.number_of_devices}</div>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-700">{item.number_of_vehicles} vehicles ({item.vehicle_type || 'Lorry'})</td>
                    <td className="py-3 px-4 font-mono font-bold text-gray-900">₹{item.confirmed_price || 0}</td>
                    <td className="py-3 px-4 text-gray-600">
                      <div>{item.expected_arrival_date || 'TBD'}</div>
                      <div className="text-[10px] text-gray-400">{item.expected_arrival_time}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        item.installation_status === 'Completed' || item.installation_status === 'Site Work Completed'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : item.installation_status === 'In Progress'
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : item.installation_status === 'Assigned'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}>
                        {item.installation_status === 'Site Work Completed' ? 'Completed' : item.installation_status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onSelectChecklist ? onSelectChecklist(item.id) : navigate(`/admin/installation-checklists/${item.id}`)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        View Details <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
