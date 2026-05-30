import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LogEntry {
  id:        string;
  tag:       string;
  message:   string;
  error?:    string;
  timestamp: string;
}

const KEY     = '@smartbrew:error_log';
const MAX_ENTRIES = 100;

function serialize(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function readLog(): Promise<LogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export async function logError(tag: string, error: unknown, message = ''): Promise<void> {
  const entry: LogEntry = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tag,
    message:   message || serialize(error),
    error:     serialize(error),
    timestamp: new Date().toISOString(),
  };
  // Always log to console for Metro
  console.error(`[${tag}]`, message || '', error);
  try {
    const existing = await readLog();
    const updated  = [entry, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // Storage failure must never throw — logging is best-effort
  }
}

export async function getLogs(): Promise<LogEntry[]> {
  return readLog();
}

export async function clearLogs(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
