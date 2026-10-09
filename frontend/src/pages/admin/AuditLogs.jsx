import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { History, Search, RefreshCw, ShieldAlert, Filter } from 'lucide-react';

export default function AuditLogs() {
  const { token } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/audit-logs?action=${encodeURIComponent(actionFilter)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [token, actionFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <History className="w-7 h-7 text-blue-600" /> Immutable System Audit Logs
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete security audit trail tracking stock movements, role updates, and job approvals.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 shadow-xs self-start"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filter */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <Filter className="w-4 h-4" /> Filter Action:
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="text-xs font-semibold px-3 py-1.5 border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Actions</option>
          <option value="ISSUE_STOCK">ISSUE_STOCK</option>
          <option value="RECEIVE_NEW_STOCK">RECEIVE_NEW_STOCK</option>
          <option value="SUBMIT_TECHNICAL_REPORT">SUBMIT_TECHNICAL_REPORT</option>
          <option value="DECLARE_RETURN">DECLARE_RETURN</option>
          <option value="VERIFY_STORE_RETURN">VERIFY_STORE_RETURN</option>
          <option value="RESOLVE_DISCREPANCY">RESOLVE_DISCREPANCY</option>
          <option value="CREATE_EMPLOYEE_USER">CREATE_EMPLOYEE_USER</option>
          <option value="UPDATE_EMPLOYEE_USER">UPDATE_EMPLOYEE_USER</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4">Actor</th>
                <th className="py-3.5 px-4">Role</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Target</th>
                <th className="py-3.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No system audit logs found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3.5 px-4 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-gray-900">
                      {log.actor_email || 'System'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                        {log.actor_role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-xs font-mono font-bold text-blue-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-600 font-mono">
                      {log.target_table}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-600 max-w-xs truncate">
                      {typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '-')}
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
