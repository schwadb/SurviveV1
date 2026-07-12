import { AppData } from '../types';
import { SCHEMA_VERSION } from '../data/seed';

interface BackupEnvelope {
  app: 'survive-budget';
  schemaVersion: number;
  exportedAt: string;
  data: AppData;
}

/** Full-data backup as a portable JSON document. */
export function serializeBackup(data: AppData, exportedAt: string): string {
  const {
    accounts, groups, categories, transactions, budgets, goals, bills, rules,
    settings, schemaVersion,
  } = data;
  const envelope: BackupEnvelope = {
    app: 'survive-budget',
    schemaVersion,
    exportedAt,
    data: {
      accounts, groups, categories, transactions, budgets, goals, bills, rules,
      settings, schemaVersion,
    },
  };
  return JSON.stringify(envelope, null, 2);
}

export interface BackupParseResult {
  data: AppData | null;
  error: string | null;
}

/** Parse and structurally validate a backup file before restoring. */
export function parseBackup(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: null, error: 'Not a valid JSON file.' };
  }
  const env = raw as Partial<BackupEnvelope>;
  if (env?.app !== 'survive-budget' || typeof env.data !== 'object' || env.data === null) {
    return { data: null, error: 'This is not a Survive Budget backup file.' };
  }
  const d = env.data as Partial<AppData>;
  const arrays: (keyof AppData)[] = [
    'accounts', 'groups', 'categories', 'transactions', 'goals', 'bills', 'rules',
  ];
  for (const key of arrays) {
    if (!Array.isArray(d[key])) return { data: null, error: `Backup is missing "${key}".` };
  }
  if (typeof d.budgets !== 'object' || d.budgets === null) {
    return { data: null, error: 'Backup is missing "budgets".' };
  }
  if (typeof d.settings !== 'object' || d.settings === null) {
    return { data: null, error: 'Backup is missing "settings".' };
  }
  if (typeof env.schemaVersion === 'number' && env.schemaVersion > SCHEMA_VERSION) {
    return { data: null, error: 'Backup was made by a newer app version.' };
  }
  return { data: { ...(d as AppData), schemaVersion: SCHEMA_VERSION }, error: null };
}
