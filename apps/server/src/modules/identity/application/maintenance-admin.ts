/** Read-only operator check for server-side maintenance commands; never creates an account. */
import type { Database } from '../../../platform/index.js';
export async function isActiveMaintenanceAdmin(
  database: Pick<Database, 'query'>,
  id: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  const result = await database.query<{ id: string }>(
    "SELECT id FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
    [id],
  );
  return result.rows.length === 1;
}
