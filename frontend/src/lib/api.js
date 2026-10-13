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
 * Submit customer feedback
 */
export async function submitFeedback(data) {
  const res = await fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || 'Submission failed');
  }

  return json;
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
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Failed to create quotation');
  }
  return json;
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
  if (!res.ok) throw new Error('Failed to fetch installation checklist detail');
  return res.json();
}

export async function createInstallationChecklist(token, data) {
  const res = await fetch(`${API_BASE}/admin/installations`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Failed to create installation checklist');
  }
  return json;
}

export async function updateInstallationChecklist(token, id, data) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Failed to update installation checklist');
  }
  return json;
}

export async function deleteInstallationChecklist(token, id) {
  const res = await fetch(`${API_BASE}/admin/installations/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || 'Failed to delete installation checklist');
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
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to calculate BOM requirements');
  return json;
}

export async function updateDeviceBom(token, deviceType, data) {
  const res = await fetch(`${API_BASE}/admin/bom/${encodeURIComponent(deviceType)}`, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to update BOM configuration');
  return json;
}

export async function resetDeviceBom(token, deviceType) {
  const res = await fetch(`${API_BASE}/admin/bom/${encodeURIComponent(deviceType)}/reset`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to reset BOM configuration');
  return json;
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





