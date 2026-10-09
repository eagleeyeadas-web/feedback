import { useState, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Wrench, CheckCircle2, Clock, AlertTriangle, ArrowRight, Search, HardDrive, Package } from 'lucide-react';

export default function TechnicalWorkspace({ onSelectChecklist }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/installations', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setChecklists(data.checklists || []);
      }
    } catch (err) {
      console.error('Failed to load Technical workspace data:', err);
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
    (c.service_engineer || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.service_assistant || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900 to-navy p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold px-2.5 py-1 bg-purple-500/30 text-purple-200 rounded-md border border-purple-400/30 uppercase tracking-wider">
            Operational Workspace
          </span>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Wrench className="w-7 h-7 text-purple-400" /> Technical Team Workspace
          </h1>
          <p className="text-xs text-white/70 mt-1 max-w-xl">
            View assigned installation jobs, inspect original Sales checklist requirements and Store-issued stock, record site completion (actual carried & installed quantities), and declare unused devices for store return.
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Assigned Jobs</p>
            <p className="text-2xl font-bold text-gray-900">{checklists.length}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Jobs In Progress</p>
            <p className="text-2xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'In Progress' || c.reconciliation_status === 'STORE_ISSUED').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Site Work Completed</p>
            <p className="text-2xl font-bold text-gray-900">
              {checklists.filter((c) => c.installation_status === 'Completed' || c.reconciliation_status === 'SITE_WORK_COMPLETED').length}
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex items-center gap-3">
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assigned jobs by client name, checklist number, or technician name..."
          className="w-full text-xs bg-transparent border-none outline-none text-gray-800 placeholder-gray-400"
        />
      </div>

      {/* Technical Jobs Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Assigned Technical Installation & Service Jobs</h3>
          <span className="text-xs text-gray-500 font-medium">{filteredChecklists.length} jobs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">Checklist No.</th>
                <th className="py-3 px-4">Client Details</th>
                <th className="py-3 px-4">Sales Device Request</th>
                <th className="py-3 px-4">Assigned Team</th>
                <th className="py-3 px-4">Arrival Date/Time</th>
                <th className="py-3 px-4">Reconciliation Status</th>
                <th className="py-3 px-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">Loading Technical jobs...</td>
                </tr>
              ) : filteredChecklists.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">No matching Technical jobs found.</td>
                </tr>
              ) : (
                filteredChecklists.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-purple-700">{item.checklist_number}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900">{item.client_name}</div>
                      <div className="text-[11px] text-gray-500">{item.client_location}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-gray-800">{item.device_type}</span>
                      <div className="text-[10px] text-gray-400">Req Qty: {item.number_of_devices}</div>
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      <div><strong className="text-gray-900">Eng:</strong> {item.service_engineer || 'Unassigned'}</div>
                      <div className="text-[10px] text-gray-500"><strong>Asst:</strong> {item.service_assistant || 'Unassigned'}</div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      <div>{item.expected_arrival_date || 'TBD'}</div>
                      <div className="text-[10px] text-gray-400">{item.expected_arrival_time}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        item.reconciliation_status === 'FULLY_RECONCILED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.reconciliation_status === 'SITE_WORK_COMPLETED'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {item.reconciliation_status || 'INITIATED'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onSelectChecklist ? onSelectChecklist(item.id) : navigate(`/admin/installation-checklists/${item.id}`)}
                        className="text-xs font-semibold text-purple-700 hover:text-purple-900 flex items-center gap-1"
                      >
                        Submit Site Report <ArrowRight className="w-3 h-3" />
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
