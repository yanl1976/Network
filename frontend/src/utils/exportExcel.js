import * as XLSX from 'xlsx';

// sheets: [{ name, columns: [{ label, prop, width, value(row) }], rows }]
export function exportExcel(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const header = sheet.columns.map((c) => c.label);
    const body = sheet.rows.map((row) => sheet.columns.map((c) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.prop];
      return v ?? '';
    }));
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = sheet.columns.map((c) => ({ wch: c.width ?? 16 }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  XLSX.writeFile(wb, fileName);
}
