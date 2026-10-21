export const rawEnvUrl = import.meta.env.VITE_API_URL || '/api';
export const API_BASE = rawEnvUrl.endsWith('/api') ? rawEnvUrl : `${rawEnvUrl.replace(/\/+$/, '')}/api`;

/**
 * Background non-blocking server wake-up ping for Render Free tier cold start
 */
let wakeupPromise = null;
export function pingServerWakeup() {
  if (!wakeupPromise) {
    wakeupPromise = fetch(`${API_BASE.replace(/\/api$/, '')}/api/health`, { signal: AbortSignal.timeout(35000) })
      .then((r) => r.json())
      .catch(() => null);
  }
  return wakeupPromise;
}

/**
 * Safely parse JSON response with graceful fallback to server text or status code
 */
export async function parseResponse(res, fallbackMessage = 'Request failed') {
  if (!res.ok) {
    let errorMsg = `${fallbackMessage} (${res.status})`;
    try {
      const json = await res.json();
      errorMsg = json.error || json.message || errorMsg;
    } catch {
      const text = await res.text().catch(() => '');
      if (text && text.length < 300) {
        errorMsg = text;
      }
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

/**
 * Submit customer feedback
 */
export async function submitFeedback(data) {
  const res = await fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Submission failed');
}

/**
 * Download feedback PDF (customer access)
 */
export function getFeedbackPDFUrl(feedbackId) {
  return `${API_BASE}/feedback/${feedbackId}/pdf`;
}

/**
 * Admin API calls with auth token
 */
function adminHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchAdminStats(token) {
  const res = await fetch(`${API_BASE}/admin/stats`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function fetchAdminFeedback(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/feedback?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch feedback');
  return res.json();
}

export async function fetchAdminFeedbackDetail(token, id) {
  const res = await fetch(`${API_BASE}/admin/feedback/${id}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch feedback detail');
  return res.json();
}

export async function downloadAdminPDF(token, id) {
  const res = await fetch(`${API_BASE}/admin/feedback/${id}/pdf`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to download PDF');
  return res.blob();
}

export async function exportCSV(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/export?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to export CSV');
  return res.blob();
}

/**
 * Quotation API helper functions
 */
export async function getNextQuotationNumber(token) {
  const res = await fetch(`${API_BASE}/admin/quotations/next-number`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch next quotation number');
  return res.json();
}

export async function createQuotation(token, data) {
  const res = await fetch(`${API_BASE}/admin/quotations`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Failed to create quotation');
}

export async function fetchAdminQuotations(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/quotations?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch quotations');
  return res.json();
}

export async function fetchQuotationDetail(token, id) {
  const res = await fetch(`${API_BASE}/admin/quotations/${id}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch quotation detail');
  return res.json();
}

export async function downloadQuotationPDF(token, id) {
  const res = await fetch(`${API_BASE}/admin/quotations/${id}/pdf`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to download quotation PDF');
  return res.blob();
}

export async function deleteQuotation(token, id) {
  const res = await fetch(`${API_BASE}/admin/quotations/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to delete quotation');
  return res.json();
}

export async function exportQuotationCSV(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/quotations/export?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to export quotation CSV');
  }
  return res.blob();
}

/**
 * Installation Checklist API Helpers
 */
export async function fetchInstallationStats(token) {
  const res = await fetch(`${API_BASE}/admin/installations/stats`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch installation statistics');
  return res.json();
}

export async function fetchInstallationChecklists(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/installations?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch installation checklists');
  return res.json();
}

export async function fetchInstallationChecklistDetail(token, id) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}`, {
    headers: adminHeaders(token),
  });
  if (res.status === 404) {
    throw new Error('Installation checklist not found or has been removed.');
  }
  return parseResponse(res, 'Failed to fetch installation checklist detail');
}

export async function createInstallationChecklist(token, data) {
  const res = await fetch(`${API_BASE}/admin/installations`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Failed to create installation checklist');
}

export async function updateInstallationChecklist(token, id, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Failed to update installation checklist');
}

export async function deleteInstallationChecklist(token, id) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to delete installation checklist');
    err.reasons = json.reasons || [];
    err.canCancel = json.canCancel;
    err.checklist = json.checklist;
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function checkInstallationChecklistEligibility(token, id) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}/deletion-check`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to check deletion eligibility');
  return json;
}

export async function previewInstallationChecklistsDeletion(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/installations/deletion-preview?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to preview checklists deletion');
  return json;
}

export async function deleteAllEligibleInstallationChecklists(token, confirmedCount, params = {}) {
  const res = await fetch(`${API_BASE}/admin/installations/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ confirmedCount, params }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to delete eligible checklists');
    err.preview = json.preview;
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function downloadInstallationPDF(token, id) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}/pdf`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to download installation PDF');
  }
  return res.blob();
}

/**
 * Download dedicated Store Manager — Device & Material Requirement Sheet PDF
 */
export async function downloadStoreRequirementPDF(token, id) {
  const res = await fetch(`${API_BASE}/admin/materials/requirements/${id}/pdf`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const resFallback = await fetch(`${API_BASE}/admin/installations/${id}/store-pdf`, {
      headers: adminHeaders(token),
    });
    if (!resFallback.ok) {
      const errorData = await resFallback.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to download Store Manager requirement PDF');
    }
    return resFallback.blob();
  }
  return res.blob();
}

/**
 * Service Engineer List & Carry / Completion Workflow APIs
 */
export async function fetchServiceEngineers(token) {
  const res = await fetch(`${API_BASE}/admin/installations/engineers`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch service engineers');
  return res.json();
}

export async function fetchEngineersAvailability(token, { startDate, endDate, duration, excludeChecklistId } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (duration) params.set('duration', duration);
  if (excludeChecklistId) params.set('excludeChecklistId', excludeChecklistId);

  const res = await fetch(`${API_BASE}/admin/installations/engineers/availability?${params.toString()}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to check engineer availability');
  }
  return res.json();
}
export const fetchEngineersAvailabilityApi = fetchEngineersAvailability;

export async function fetchEngineersCalendar(token, { startDate, endDate } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  const res = await fetch(`${API_BASE}/admin/installations/engineers/calendar?${params.toString()}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to fetch engineer calendar');
  }
  return res.json();
}

export async function fetchDeviceCarryRecord(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/carry-record`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch device carry record');
  return res.json();
}

export async function submitDeviceCarryRecord(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/carry-record`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit device carry record');
  return json;
}

export async function startInstallationJob(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/start-installation`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to start installation job');
  return json;
}

export async function fetchInstallationCompletionReport(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/completion-report`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch completion report');
  return res.json();
}

export async function submitInstallationCompletionReport(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/completion-report`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit installation completion report');
  return json;
}

export async function fetchDeviceConfigurations(token) {
  const res = await fetch(`${API_BASE}/admin/installations/device-configurations`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch device configurations');
  return res.json();
}

export async function fetchAdditionalCustomerInstallations(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/additional-installations`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch additional customer installations');
  return res.json();
}

export async function fetchPendingStoreReturns(token) {
  const res = await fetch(`${API_BASE}/admin/installations/pending-returns`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch pending store returns');
  return res.json();
}

/**
 * Inventory & Store Manager Workspace APIs
 */
export async function fetchInventoryProducts(token) {
  const res = await fetch(`${API_BASE}/admin/inventory`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch inventory products');
  return res.json();
}

export async function createDeviceProductApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/products`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create device product');
  return json;
}

export async function fetchInventorySummary(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/summary`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch inventory summary');
  return res.json();
}

export async function fetchInventoryTransactions(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/inventory/transactions?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch inventory transactions');
  return res.json();
}

export async function receiveInventoryStock(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/receive`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to receive stock');
  return json;
}

export async function adjustInventoryStock(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/adjust`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to adjust stock');
  return json;
}

export async function fetchAllStoreReturns(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/returns`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch store returns');
  return res.json();
}

export async function verifyStoreReturnApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/verify-return`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to verify store return');
  return json;
}

export async function triggerInventoryCleanupApi(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/cleanup`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to trigger history cleanup');
  return json;
}

export async function fetchInventoryCleanupLogsApi(token, limit = 20) {
  const res = await fetch(`${API_BASE}/admin/inventory/cleanup-logs?limit=${limit}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch history cleanup logs');
  return json;
}

export async function deleteStockMovementApi(token, id) {
  const res = await fetch(`${API_BASE}/admin/inventory/movements/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete stock movement');
  return json;
}

export async function clearStockMovementsHistoryApi(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/inventory/movements?${query}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear stock movement history');
  return json;
}

export async function deleteStoreReturnApi(token, id) {
  const res = await fetch(`${API_BASE}/admin/inventory/returns/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete return record');
  return json;
}

export async function clearStoreReturnsHistoryApi(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/inventory/returns?${query}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear return records');
  return json;
}


/**
 * Trigger user-activity-based 24-hour retention cleanup check
 */
export async function triggerActivityCleanup(token) {
  const res = await fetch(`${API_BASE}/admin/cleanup`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to trigger cleanup check');
  return json;
}

/**
 * Fetch cleanup status and last successful execution timestamp
 */
export async function fetchCleanupStatus(token) {
  const res = await fetch(`${API_BASE}/admin/cleanup/status`, {
    headers: adminHeaders(token),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Failed to fetch cleanup status');
  return json;
}

/**
 * Customers API helpers
 */
export async function fetchCustomers(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/customers?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch customers');
  return res.json();
}

export async function createCustomer(token, data) {
  const res = await fetch(`${API_BASE}/admin/customers`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to save customer');
  return json;
}

/**
 * User & Employee Management APIs
 */
export async function fetchUsers(token) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch employees');
  return res.json();
}

export async function createUser(token, data) {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create employee');
  return json;
}

export async function updateUser(token, id, data) {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update employee');
  return json;
}

export async function deleteUser(token, id) {
  const res = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete employee');
  return json;
}

/**
 * Audit Logs API
 */
export async function fetchAuditLogs(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/audit-logs?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch audit logs');
  return res.json();
}

/**
 * Discrepancy & Checklist Workflow Action APIs
 */
export async function fetchInventoryDiscrepancies(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/discrepancies`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch discrepancies');
  return res.json();
}

export async function issueStockJob(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/issue-stock`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to issue stock');
  return json;
}

export async function submitTechnicalReportJob(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/technical-report`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit technical report');
  return json;
}

export async function declareReturnJob(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/declare-return`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to declare returns');
  return json;
}

export async function verifyReturnJob(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/verify-return`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to verify return');
  return json;
}

export async function verifyStoreMaterialReturnApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/verify-material-return`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to verify store material return');
  return json;
}

export async function fetchJobFinalBom(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/final-bom`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch job final BOM');
  return res.json();
}

export async function resolveDiscrepancyJob(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/resolve-discrepancy`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to resolve discrepancy');
  return json;
}

/**
 * Bill of Materials (BOM) API helpers
 */
export async function fetchBoms(token) {
  const res = await fetch(`${API_BASE}/admin/bom`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch BOM configurations');
  return res.json();
}

export async function fetchBomByDeviceType(token, deviceType) {
  const res = await fetch(`${API_BASE}/admin/bom/${encodeURIComponent(deviceType)}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.warning || err.error || 'Failed to fetch device BOM');
  }
  return res.json();
}

export async function calculateBomRequirements(token, data) {
  const res = await fetch(`${API_BASE}/admin/bom/calculate`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Failed to calculate BOM requirements');
}

export async function updateDeviceBom(token, deviceType, data) {
  const res = await fetch(`${API_BASE}/admin/bom/${encodeURIComponent(deviceType)}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  return parseResponse(res, 'Failed to update BOM configuration');
}

export async function resetDeviceBom(token, deviceType) {
  const res = await fetch(`${API_BASE}/admin/bom/${encodeURIComponent(deviceType)}/reset`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  return parseResponse(res, 'Failed to reset BOM configuration');
}

export async function fetchBomUnits(token) {
  const res = await fetch(`${API_BASE}/admin/bom/units`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch BOM units');
  return res.json();
}

export async function fetchChecklistBomHistory(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/bom/history?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch checklist BOM history');
  return res.json();
}

/**
 * Material Stock & Issuance API helpers
 */
export async function fetchMaterialInventory(token) {
  const res = await fetch(`${API_BASE}/admin/materials`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch material inventory');
  return res.json();
}

export async function adjustMaterialStock(token, data) {
  const res = await fetch(`${API_BASE}/admin/materials/adjust`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to adjust material stock');
  return json;
}

export async function issueMaterialsForChecklist(token, data) {
  const res = await fetch(`${API_BASE}/admin/materials/issue-for-checklist`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to issue materials');
  return json;
}

export async function fetchMaterialTransactions(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/materials/transactions?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch material transactions');
  return res.json();
}

/**
 * Store Manager Material Requirements API helpers
 */
export async function fetchStoreMaterialRequirements(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/materials/requirements?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch store material requirements');
  return res.json();
}

export async function fetchStoreMaterialRequirementDetail(token, id) {
  const res = await fetch(`${API_BASE}/admin/materials/requirements/${id}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch requirement details');
  return res.json();
}

export async function syncStoreMaterialRequirements(token) {
  const res = await fetch(`${API_BASE}/admin/materials/requirements/sync`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to sync requirements');
  return res.json();
}

/**
 * Opening Stock API Helpers
 */
export async function setMaterialOpeningStockApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/materials/opening-stock`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to set material opening stock');
  return json;
}

export async function setDeviceOpeningStockApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/opening-stock`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to set device opening stock');
  return json;
}

/**
 * Unified Full Job Stock Issuance API
 */
export async function issueFullJobStockApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/materials/issue-full-job`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to issue job stock');
  return json;
}

export async function issueDevicesForChecklistApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/issue-devices`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to issue devices');
  return json;
}

/**
 * Combined Movements API
 */
export async function fetchAllMovements(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/inventory/all-movements?${query}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch combined stock movements');
  return res.json();
}

/**
 * Technician Job Expenses API
 */
export async function fetchJobExpenses(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/expenses`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to fetch job expenses');
  }
  return res.json();
}

export async function saveJobExpensesApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/expenses`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to save job expenses');
  return json;
}

export async function downloadJobExpensePdfApi(token, checklistId, inline = false) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/expenses/pdf${inline ? '?inline=true' : ''}`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to generate technician expense PDF');
  }
  return res.blob();
}

export async function uploadExpenseReceiptApi(token, checklistId, file) {
  const formData = new FormData();
  formData.append('receipt', file);

  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/expenses/receipt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to upload receipt');
  return json;
}

export async function fetchTechnicianMonthlyExpenseSummary(token) {
  const res = await fetch(`${API_BASE}/admin/installations/technician-expenses/monthly-summary`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Failed to fetch monthly expense summary');
  }
  return res.json();
}

/**
 * Coordinator Travel & Accommodation Booking APIs
 */
export async function fetchCoordinatorBookings(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch coordinator bookings');
  return json;
}

export async function fetchCoordinatorBookingDetails(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch booking details');
  return json;
}

export async function saveCoordinatorBookingApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to save booking details');
  return json;
}

export async function updateCoordinatorBookingStatusApi(token, checklistId, statusOrPayload, notes) {
  const bodyPayload = typeof statusOrPayload === 'object' && statusOrPayload !== null
    ? statusOrPayload
    : { status: statusOrPayload, notes };
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/status`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(bodyPayload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update booking status');
  return json;
}

export async function updateCoordinatorOutboundStatusApi(token, checklistId, status, notes) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/outbound-status`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ status, notes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update outbound travel status');
  return json;
}

export async function updateCoordinatorRoomStatusApi(token, checklistId, status, notes) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/room-status`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ status, notes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update room booking status');
  return json;
}

export async function updateCoordinatorReturnStatusApi(token, checklistId, status, notes) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/return-status`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ status, notes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update return ticket status');
  return json;
}

export async function fetchCoordinatorBookingHistory(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/history`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch booking history');
  return json;
}

export async function extendCoordinatorRoomBookingApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/extend-room`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to extend room booking');
  return json;
}

export async function updateCoordinatorReturnTicketApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/return-ticket`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update return ticket booking');
  return json;
}

/**
 * Fetch Return Ticket Tasks (filtered by technician for TECHNICAL role, all for COORDINATOR/ADMIN)
 */
export async function fetchReturnTicketTasksApi(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/return-ticket-tasks${query ? '?' + query : ''}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch return ticket tasks');
  return json.tasks || [];
}

/**
 * Technician submits return ticket booking details for Coordinator verification
 */
export async function submitTechnicianReturnTicketApi(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/technician-return-ticket`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit return ticket details');
  return json;
}

/**
 * Coordinator marks Return Ticket Task as Verified / Completed
 */
export async function verifyReturnTicketApi(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/verify-return-ticket`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to verify return ticket task');
  return json;
}

/**
 * Coordinator requests correction on return ticket details
 */
export async function requestReturnTicketCorrectionApi(token, checklistId, reason) {
  const res = await fetch(`${API_BASE}/admin/coordinator/bookings/${checklistId}/request-return-ticket-correction`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ reason }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to request return ticket correction');
  return json;
}

/**
 * Upload ticket or receipt file (image/PDF)
 */
export async function uploadTicketReceiptApi(token, file, checklistId) {
  const formData = new FormData();
  formData.append('file', file);
  if (checklistId) formData.append('checklistId', checklistId);

  const res = await fetch(`${API_BASE}/admin/coordinator/upload-ticket-receipt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to upload ticket receipt');
  return json;
}

/**
 * Checklist Deletion & Complete Workflow Cascade APIs
 * Authorized for SALES, COORDINATOR, and ADMIN
 */
export async function fetchChecklistDeletionPreviewApi(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/installations/checklists/deletion-preview?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to preview checklists deletion');
  return json;
}

export async function deleteAllEligibleChecklistsApi(token, confirmedCount, params = {}) {
  const res = await fetch(`${API_BASE}/admin/installations/checklists/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ confirmedCount, params }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to delete checklists');
    err.preview = json.preview;
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function checkChecklistDeletionEligibilityApi(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/deletion-check`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to check deletion eligibility');
  return json;
}

export async function deleteChecklistApi(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to delete checklist');
    err.reasons = json.reasons || [];
    err.canCancel = json.canCancel;
    err.checklist = json.checklist;
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function cancelChecklistApi(token, checklistId, reason = '') {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/cancel`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ reason }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to cancel checklist');
  return json;
}

/**
 * Coordinator Schedule & Availability Management APIs
 */
export async function fetchCoordinatorExtensionRequests(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/extensions?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch extension requests');
  return json;
}

export async function approveCoordinatorExtensionRequest(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/extensions/${id}/approve`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to approve extension request');
    err.conflict = json.conflict;
    throw err;
  }
  return json;
}

export async function rejectCoordinatorExtensionRequest(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/extensions/${id}/reject`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reject extension request');
  return json;
}

export async function fetchCoordinatorRestDayRequests(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/rest-days?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch rest days');
  return json;
}

export async function approveCoordinatorRestDay(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/rest-days/${id}/approve`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to approve rest day');
    err.conflict = json.conflict;
    throw err;
  }
  return json;
}

export async function rejectCoordinatorRestDay(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/rest-days/${id}/reject`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reject rest day');
  return json;
}

export async function fetchCoordinatorLeaveRequests(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/leaves?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch leaves');
  return json;
}

export async function approveCoordinatorLeave(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/leaves/${id}/approve`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to approve leave request');
    err.conflict = json.conflict;
    throw err;
  }
  return json;
}

export async function rejectCoordinatorLeave(token, id, decisionNotes = '') {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/leaves/${id}/reject`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ decision_notes: decisionNotes }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reject leave request');
  return json;
}

export async function fetchCoordinatorScheduleCalendar(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/calendar?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch schedule calendar');
  return json;
}

export async function fetchCoordinatorScheduleConflicts(token) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/conflicts`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch schedule conflicts');
  return json;
}

export async function fetchCoordinatorAffectedBookings(token) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/affected-bookings`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch affected bookings');
  return json;
}

export async function fetchScheduleRevisionHistory(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/history/${checklistId}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch schedule revision history');
  return json;
}

export async function fetchCoordinatorNotifications(token) {
  const res = await fetch(`${API_BASE}/admin/coordinator/notifications`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch notifications');
  return json;
}

export async function markCoordinatorNotificationReadApi(token, id) {
  const res = await fetch(`${API_BASE}/admin/coordinator/notifications/${id}/read`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  return res.json();
}

/**
 * Technician Schedule Extension, Rest & Leave Request APIs
 */
export async function submitTechnicianScheduleExtension(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/request-extension`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit schedule extension request');
  return json;
}

export async function fetchTechnicianExtensionRequests(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/extension-requests`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch extension requests');
  return json;
}

export async function submitTechnicianRestDayRequest(token, data) {
  const res = await fetch(`${API_BASE}/admin/installations/rest-days/request`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit rest-day request');
  return json;
}

export async function submitTechnicianLeaveRequest(token, data) {
  const res = await fetch(`${API_BASE}/admin/installations/leaves/request`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to submit leave request');
  return json;
}

export async function fetchTechnicianNotifications(token) {
  const res = await fetch(`${API_BASE}/admin/installations/notifications/tech`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch technician notifications');
  return json;
}

/**
 * Loose Backup Items API Helpers
 */
export async function fetchBackupProducts(token) {
  const res = await fetch(`${API_BASE}/admin/installations/backup-products`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch backup products');
  return json.products || [];
}

export async function fetchBackupDeclaration(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/backup-declaration`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch backup declaration');
  return json.declaration || null;
}

export async function saveBackupDeclaration(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/backup-declaration`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to save backup declaration');
  return json;
}

export async function verifyStoreBackupReturns(token, checklistId, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/backup-returns/verify`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to verify backup returns');
  return json;
}

/**
 * Calculated Camera Set Availability and Allocations API Helpers
 */
export async function fetchCalculatedDeviceSets(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/calculated-sets`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch calculated device sets');
  return json;
}

export async function fetchDeviceAllocationsApi(token) {
  const res = await fetch(`${API_BASE}/admin/inventory/allocations`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch device allocations');
  return json;
}

export async function allocateDeviceSetsApi(token, data) {
  const res = await fetch(`${API_BASE}/admin/inventory/allocations`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to allocate device sets');
  return json;
}

export async function releaseDeviceAllocationApi(token, allocationId, reason = '') {
  const res = await fetch(`${API_BASE}/admin/inventory/allocations/${allocationId}/release`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ reason }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to release allocation');
  return json;
}

/**
 * Checklist Creation: Real-time Device Component Availability & Shortage Check APIs
 */
export async function fetchDeviceAvailabilityApi(token) {
  const res = await fetch(`${API_BASE}/admin/installations/device-availability`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch device availability');
  return json;
}

export async function checkComponentAvailabilityApi(token, deviceConfigurations) {
  const res = await fetch(`${API_BASE}/admin/installations/check-component-availability`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ device_configurations: deviceConfigurations }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to check component availability');
  return json;
}

/**
 * Customer Feedback Deletion APIs
 */
export async function fetchFeedbackDeletionPreview(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/feedback/deletion-preview?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to preview feedback deletion');
  return json;
}

export async function deleteAdminFeedback(token, id) {
  const res = await fetch(`${API_BASE}/admin/feedback/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete feedback');
  return json;
}

export async function deleteAllAdminFeedback(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/feedback/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete feedback records');
  return json;
}

/**
 * Customer Directory Deletion APIs
 */
export async function fetchCustomerDeletionPreview(token, params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/customers/deletion-preview?${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to preview customer deletion');
  return json;
}

export async function deleteCustomerApi(token, id) {
  const res = await fetch(`${API_BASE}/admin/customers/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to delete customer');
    err.reasons = json.reasons || [];
    throw err;
  }
  return json;
}

export async function deleteAllCustomersApi(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/customers/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete customers');
  return json;
}

/**
 * Quotation Test Cleanup API (Protected)
 */
export async function cleanTestQuotationsApi(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/quotations/delete-test`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clean test quotations');
  return json;
}

/**
 * Coordinator Schedule Request Deletion APIs
 */
export async function deleteCoordinatorExtensionRequest(token, id) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/extensions/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete extension request');
  return json;
}

export async function deleteAllCoordinatorExtensionRequests(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/extensions/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear extension requests');
  return json;
}

export async function deleteCoordinatorRestDayRequest(token, id) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/rest-days/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete rest day request');
  return json;
}

export async function deleteAllCoordinatorRestDayRequests(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/rest-days/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear rest day requests');
  return json;
}

export async function deleteCoordinatorLeaveRequest(token, id) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/leaves/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete leave request');
  return json;
}

export async function deleteAllCoordinatorLeaveRequests(token, data = {}) {
  const res = await fetch(`${API_BASE}/admin/coordinator/schedule/leaves/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear leave requests');
  return json;
}

export async function deleteCoordinatorNotification(token, id) {
  const res = await fetch(`${API_BASE}/admin/coordinator/notifications/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete notification');
  return json;
}

export async function deleteAllCoordinatorNotifications(token) {
  const res = await fetch(`${API_BASE}/admin/coordinator/notifications/delete-all`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to clear notifications');
  return json;
}

// ============================================================
// HR WORKSPACE APIS
// ============================================================

export async function fetchHrAvailabilityOverview(token, date = '') {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${API_BASE}/admin/hr/availability${query}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch technician availability overview');
  return json;
}

export async function setHrManualAvailability(token, data) {
  const res = await fetch(`${API_BASE}/admin/hr/availability/override`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to set manual availability override');
  return json;
}

export async function reverseHrManualAvailability(token, overrideId, reason = '') {
  const res = await fetch(`${API_BASE}/admin/hr/availability/override/${overrideId}/reverse`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ reason }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reverse availability override');
  return json;
}

export async function fetchHrExtensionRequests(token, queryParams = {}) {
  const params = new URLSearchParams();
  if (queryParams.status) params.set('status', queryParams.status);
  const qStr = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/admin/hr/extensions${qStr}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch extension requests');
  return json;
}

export async function approveHrExtensionRequest(token, id, data = {}) {
  const res = await fetch(`${API_BASE}/admin/hr/extensions/${id}/approve`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to approve extension request');
  return json;
}

export async function rejectHrExtensionRequest(token, id, data = {}) {
  const res = await fetch(`${API_BASE}/admin/hr/extensions/${id}/reject`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reject extension request');
  return json;
}

export async function fetchHrAvailabilityCalendar(token, queryParams = {}) {
  const params = new URLSearchParams();
  if (queryParams.startDate) params.set('startDate', queryParams.startDate);
  if (queryParams.endDate) params.set('endDate', queryParams.endDate);
  if (queryParams.view) params.set('view', queryParams.view);
  if (queryParams.engineerId) params.set('engineerId', queryParams.engineerId);
  const qStr = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/admin/hr/calendar${qStr}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch HR availability calendar');
  return json;
}

export async function fetchHrNotifications(token) {
  const res = await fetch(`${API_BASE}/admin/hr/notifications`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch HR notifications');
  return json;
}

export async function fetchHrOverdueRecords(token, queryParams = {}) {
  const params = new URLSearchParams();
  if (queryParams.category) params.set('category', queryParams.category);
  if (queryParams.resolved !== undefined) params.set('resolved', queryParams.resolved);
  const qStr = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/admin/hr/overdue${qStr}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch HR overdue records');
  return json;
}

export async function triggerHrOverdueCheck(token, body = {}) {
  const res = await fetch(`${API_BASE}/admin/hr/overdue/check`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to trigger overdue check');
  return json;
}

/**
 * Product Courier Workflow API Helpers
 */
export async function fetchCourierCompanies(token) {
  const res = await fetch(`${API_BASE}/admin/courier/companies`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch courier companies');
  return json.companies || [];
}

export async function fetchCourierDispatches(token, queryParams = {}) {
  const params = new URLSearchParams();
  if (queryParams.checklistId) params.set('checklistId', queryParams.checklistId);
  if (queryParams.search) params.set('search', queryParams.search);
  if (queryParams.status) params.set('status', queryParams.status);
  if (queryParams.page) params.set('page', queryParams.page);
  if (queryParams.limit) params.set('limit', queryParams.limit);
  const qStr = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/admin/courier${qStr}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch courier dispatches');
  return json;
}

export async function fetchCourieredChecklists(token, queryParams = {}) {
  const params = new URLSearchParams();
  if (queryParams.search) params.set('search', queryParams.search);
  if (queryParams.status) params.set('status', queryParams.status);
  if (queryParams.page) params.set('page', queryParams.page);
  if (queryParams.limit) params.set('limit', queryParams.limit);
  const qStr = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/admin/courier/checklists${qStr}`, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch couriered checklists');
  return json;
}

export async function fetchCourierDispatchByChecklist(token, checklistId) {
  const res = await fetch(`${API_BASE}/admin/courier/${checklistId}`, {
    headers: adminHeaders(token),
  });
  if (res.status === 404) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch courier dispatch detail');
  return json;
}

export async function dispatchChecklistViaCourierApi(token, payload) {
  const res = await fetch(`${API_BASE}/admin/courier/dispatch`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to dispatch checklist via courier');
  return json;
}

export async function updateCourierStatusApi(token, dispatchId, payload) {
  const res = await fetch(`${API_BASE}/admin/courier/${dispatchId}/status`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update courier delivery status');
  return json;
}

export async function recordCourierReturnApi(token, dispatchId, payload) {
  const res = await fetch(`${API_BASE}/admin/courier/${dispatchId}/return`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to process courier return');
  return json;
}

export async function confirmCourierCustomerInstalledApi(token, checklistId, payload = {}) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/courier-customer-installed`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to confirm customer independent installation');
  return json;
}

export async function requestCourierTechnicianApi(token, checklistId, payload = {}) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/courier-request-technician`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to request technician for couriered order');
  return json;
}

export async function scheduleCourierTechnicianApi(token, checklistId, payload = {}) {
  const res = await fetch(`${API_BASE}/admin/installations/${checklistId}/courier-schedule-technician`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error || 'Failed to schedule technician for couriered order');
    err.conflict = json.conflict;
    throw err;
  }
  return json;
}

// ==========================================
// Web Push Notifications API Endpoints
// ==========================================

export async function getVapidPublicKeyApi() {
  const res = await fetch(`${API_BASE}/notifications/vapid-public-key`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to retrieve VAPID public key');
  return json.publicKey;
}

export async function subscribePushApi(token, payload) {
  const res = await fetch(`${API_BASE}/notifications/subscribe`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to register push subscription');
  return json;
}

export async function unsubscribePushApi(token, endpoint) {
  const res = await fetch(`${API_BASE}/notifications/unsubscribe`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ endpoint }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to remove push subscription');
  return json;
}

export async function getPushSubscriptionStatusApi(token, endpoint) {
  const url = endpoint
    ? `${API_BASE}/notifications/subscription-status?endpoint=${encodeURIComponent(endpoint)}`
    : `${API_BASE}/notifications/subscription-status`;
  const res = await fetch(url, {
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to check subscription status');
  return json;
}

export async function sendTestPushNotificationApi(token) {
  const res = await fetch(`${API_BASE}/notifications/test`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to send test push notification');
  return json;
}











