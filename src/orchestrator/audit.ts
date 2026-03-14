import { appendJsonLine } from '../fs/index.js';

export interface AuditEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  data?: Record<string, unknown>;
}

export const appendAuditEntry = async (
  auditLogFile: string,
  entry: AuditEntry
): Promise<void> => {
  await appendJsonLine(auditLogFile, entry);
};
