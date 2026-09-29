const rawEnvUrl = import.meta.env.VITE_API_URL || '/api';
const API_BASE = rawEnvUrl.endsWith('/api') ? rawEnvUrl : `${rawEnvUrl.replace(/\/+$/, '')}/api`;

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

