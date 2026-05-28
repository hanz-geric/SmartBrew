import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

function escapeCell(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): Promise<void> {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];
  const csv = lines.join('\r\n');

  const file = new File(Paths.cache, filename);
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: `Export ${filename}` });
}
