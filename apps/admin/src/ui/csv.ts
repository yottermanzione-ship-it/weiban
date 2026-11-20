type CsvValue = string | number | null | undefined;

export interface SafeCsv<T> {
  filename: string;
  fields: { title: string; value: (row: T) => CsvValue }[];
}

/** 展示名与自由文本可以带联系方式，导出时同时去掉用户编号。 */
export function redactContact(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d){8}(?!\d)/g, '[手机号]');
}

function csvCell(value: CsvValue): string {
  if (value == null) return '""';
  if (typeof value === 'number') return String(value);
  const safe = redactContact(value).replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (id) => id.slice(0, 4) + '…' + id.slice(-4),
  );
  const text = /^[\s]*[=+\-@]/.test(safe) || /^[\t\r\n]/.test(safe) ? "'" + safe : safe;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function downloadCsv<T>(config: SafeCsv<T>, rows: readonly T[]) {
  downloadCsvRows(
    config.filename,
    config.fields.map((field) => field.title),
    rows.map((row) => config.fields.map((field) => field.value(row))),
  );
}

export function downloadCsvRows(
  filename: string,
  headers: readonly string[],
  rows: readonly CsvValue[][],
) {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
