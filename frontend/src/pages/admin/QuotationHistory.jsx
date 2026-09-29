import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { fetchAdminQuotations, downloadQuotationPDF, deleteQuotation, fetchQuotationDetail } from '../../lib/api';
import { Search, Download, Trash2, Eye, FileText, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';

export default function QuotationHistory() {
  const { session } = useAuth();
  const token = session?.access_token;

  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Detail Modal
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Delete Confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    loadQuotations();
  }, [token, page, search]);

  const loadQuotations = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchAdminQuotations(token, { search, page, limit: 15 });
      setQuotations(res.quotations || []);
      setTotalPages(res.totalPages || 1);
      setTotalCount(res.totalCount || 0);
    } catch (err) {
      console.error('Failed to load quotation history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (id, qNo) => {
    try {
      const blob = await downloadQuotationPDF(token, id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EagleEye_Quotation_${(qNo || 'CQS').replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download quotation PDF');
    }
  };

  const handleViewDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await fetchQuotationDetail(token, id);
      setSelectedQuotation(res.quotation);
      setSelectedItems(res.items || []);
    } catch (err) {
      console.error('View detail error:', err);
      alert('Failed to fetch quotation details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteQuotation(token, deleteTarget.id);
      setDeleteTarget(null);
      loadQuotations();
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete quotation');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <FileText className="w-7 h-7 text-blue-600" />
            Quotation History
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Search, view, download, or delete past generated quotations ({totalCount} total).
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search customer name or quotation #..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Quotations Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span>Loading quotation records...</span>
          </div>
        ) : quotations.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            No quotations found matching your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-navy text-white uppercase text-[11px] tracking-wider">
                  <th className="p-3">Quotation No</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Customer Name</th>
                  <th className="p-3">Contact Person</th>
                  <th className="p-3 text-right">Net Amount</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50 transition">
                    <td className="p-3 font-mono font-bold text-blue-900">{q.quotation_number}</td>
                    <td className="p-3 text-gray-600">{q.quotation_date}</td>
                    <td className="p-3 font-semibold text-gray-900">{q.customer_name}</td>
                    <td className="p-3 text-gray-600">{q.contact_person || '-'}</td>
                    <td className="p-3 text-right font-mono font-bold text-gray-900">
                      ₹{parseFloat(q.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleViewDetail(q.id)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(q.id, q.quotation_number)}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition"
                          title="Download PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(q)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete Quotation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between text-xs text-gray-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="p-1.5 border rounded-lg hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="p-1.5 border rounded-lg hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      {selectedQuotation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h2 className="text-xl font-bold text-navy">
                  Quotation Detail: {selectedQuotation.quotation_number}
                </h2>
                <p className="text-xs text-gray-500">Date: {selectedQuotation.quotation_date}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuotation(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Info */}
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl text-xs">
              <div>
                <span className="font-bold text-gray-700 block">Customer Name:</span>
                <span className="text-gray-900">{selectedQuotation.customer_name}</span>
                {selectedQuotation.contact_person && (
                  <p className="text-gray-600">Attn: {selectedQuotation.contact_person}</p>
                )}
                {selectedQuotation.phone_number && (
                  <p className="text-gray-600">Ph: {selectedQuotation.phone_number}</p>
                )}
              </div>
              <div>
                <span className="font-bold text-gray-700 block">Billing Address:</span>
                <p className="text-gray-600">{selectedQuotation.address || 'N/A'}</p>
                {selectedQuotation.gst_number && (
                  <p className="text-gray-800 font-semibold mt-1">GSTIN: {selectedQuotation.gst_number}</p>
                )}
              </div>
            </div>

            {/* Items Table */}
            <div>
              <h3 className="text-xs font-bold text-gray-700 mb-2 uppercase">Items Breakdown</h3>
              <table className="w-full text-left text-xs border-collapse border">
                <thead>
                  <tr className="bg-gray-100 text-gray-700">
                    <th className="p-2 border">#</th>
                    <th className="p-2 border">Description</th>
                    <th className="p-2 border text-center">Qty</th>
                    <th className="p-2 border text-right">Rate</th>
                    <th className="p-2 border text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((item, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 border text-center">{i + 1}</td>
                      <td className="p-2 border font-medium">{item.item_description}</td>
                      <td className="p-2 border text-center">{item.qty} {item.uom}</td>
                      <td className="p-2 border text-right">₹{parseFloat(item.rate).toLocaleString('en-IN')}</td>
                      <td className="p-2 border text-right font-bold">₹{parseFloat(item.amount).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary */}
            <div className="bg-blue-50 p-4 rounded-xl flex justify-between items-center text-sm font-bold text-blue-900">
              <span>NET TOTAL AMOUNT:</span>
              <span className="text-lg">₹{parseFloat(selectedQuotation.net_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleDownload(selectedQuotation.id, selectedQuotation.quotation_number)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold">Delete Quotation?</h3>
            </div>
            <p className="text-xs text-gray-600">
              Are you sure you want to permanently delete quotation <strong className="text-gray-900">{deleteTarget.quotation_number}</strong> for <strong className="text-gray-900">{deleteTarget.customer_name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
