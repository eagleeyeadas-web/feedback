import supabase from './supabase.js';

/**
 * Creates an immutable audit log entry
 */
export async function logAudit({
  actor_id,
  actor_email,
  actor_role,
  action,
  target_table,
  target_id = null,
  details = null,
}) {
  try {
    const entry = {
      actor_id: actor_id || null,
      actor_email: actor_email || 'system',
      actor_role: actor_role || 'SYSTEM',
      action,
      target_table,
      target_id: target_id ? String(target_id) : null,
      details,
      created_at: new Date().toISOString(),
    };
    await supabase.from('audit_logs').insert([entry]);
  } catch (err) {
    console.error('Audit log write error:', err.message);
  }
}

/**
 * Fetches audit logs with search, filtering, and pagination
 */
export async function getAuditLogs(params = {}) {
  const { page = 1, limit = 20, action = '', search = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (action) query = query.eq('action', action);
  if (search) {
    query = query.or(`actor_email.ilike.%${search}%,action.ilike.%${search}%,target_table.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    logs: data || [],
    totalCount: count || 0,
    page: pageNum,
    totalPages: Math.ceil((count || 0) / limitNum) || 1,
  };
}
