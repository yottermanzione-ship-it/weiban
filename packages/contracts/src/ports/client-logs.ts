import type { Tx } from './common.js';
import type { ClientRuntimeEvent } from '../http/client-logs.js';
/** support 在工单同一事务中存技术快照；不读写 client_logs 的表。 */
export interface ClientLogsPort {
  attach(tx: Tx, userId: string, ticketId: string, events: ClientRuntimeEvent[]): Promise<void>;
}
