import { getDbReady } from '@/lib/db-neon';

export interface LogActionParams {
  adminId: string;
  action: string;
  targetUserId?: string | null;
  targetCompany?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Log an admin action to the admin_activity_log table.
 * Silently swallows errors so a logging failure never breaks the actual action.
 */
export async function logAdminAction(params: LogActionParams): Promise<void> {
  try {
    const sql = await getDbReady();
    const { adminId, action, targetUserId = null, targetCompany = null, metadata = {} } = params;
    await sql`
      INSERT INTO admin_activity_log
        (admin_id, action, target_user_id, target_company, metadata)
      VALUES
        (${adminId}, ${action}, ${targetUserId}, ${targetCompany}, ${JSON.stringify(metadata)})
    `;
  } catch (e) {
    // Never let logging break the main action
    console.error('[adminActivityLog] Failed to log action:', e);
  }
}