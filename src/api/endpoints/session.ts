import client from '../client';
import { CashSession } from '../../types';

const CTRL = '/controllers/cashSessionController.php';

async function post<T>(action: string, extra?: Record<string, string | number>) {
  const params = new URLSearchParams();
  params.append('action', action);
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => params.append(k, String(v)));
  }
  const { data } = await client.post<T>(CTRL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data;
}

export async function getSession(): Promise<CashSession | null> {
  const data = await post<{ status: string; session: CashSession | null }>('getSession');
  return data.session ?? null;
}

export async function openSession(starting_cash: number): Promise<void> {
  const data = await post<{ status: string; message?: string }>('openSession', { starting_cash });
  if (data.status !== 'success') throw new Error(data.message ?? 'Failed to open session');
}

export async function closeSession(
  session_id: number,
  actual_cash: number,
): Promise<{ expected_cash: number; difference: number }> {
  const data = await post<{
    status: string;
    message?: string;
    expected_cash: number;
    difference: number;
  }>('closeSession', { session_id, actual_cash });

  if (data.status !== 'success') throw new Error(data.message ?? 'Failed to close session');
  return { expected_cash: data.expected_cash, difference: data.difference };
}
