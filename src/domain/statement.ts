import { cents, sumCents } from './money';

// Legacy persisted identifier retained for compatibility. The owner's bank is
// Old National Bank; this choice uses mapped-csv, not a verified bank adapter.
export type Bank = 'chase' | 'south-national';
export type IssueCode = 'invalidDate' | 'invalidAmount' | 'duplicateRow' | 'ambiguousDirection' | 'columnMismatch';
export type BankRow = { line: number; date: string; description: string; amountCents: number; issues: IssueCode[] };
export type StatementPreview = {
  bank: Bank; accountAlias: string; rows: BankRow[];
  errors: { line: number; code: IssueCode }[];
  adapter: 'chase-csv' | 'mapped-csv'; from: string; to: string;
  creditsCents: number; debitsCents: number;
};

// Strict RFC-4180-style parser: quoted commas/newlines, escaped quotes, UTF-8 BOM.
export function parseCsv(text: string): string[][] {
  if (text.length > 2_000_000) throw new Error('fileTooLarge');
  if (text.includes('\0')) throw new Error('invalidCsv');
  const records: string[][] = []; let record: string[] = []; let field = '';
  let quoted = false; let closed = false;
  const input = text.replace(/^\uFEFF/, '');
  const pushField = () => { record.push(field); field = ''; closed = false; };
  const pushRecord = () => {
    pushField();
    if (record.some(value => value.trim())) records.push(record);
    record = [];
    if (records.length > 5001) throw new Error('tooManyRows');
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === ',') pushField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && input[i + 1] === '\n') i++; pushRecord(); }
    else if (closed || char === '"') throw new Error('invalidCsv');
    else field += char;
  }
  if (quoted) throw new Error('invalidCsv');
  if (field || record.length || closed) pushRecord();
  return records;
}

export function isoDate(value: string): string {
  let date = value.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (us) date = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalidDate');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('invalidDate');
  return date;
}

export function previewStatement(text: string, bank: Bank, accountAlias: string): StatementPreview {
  const [headers, ...records] = parseCsv(text);
  if (!headers || !records.length) throw new Error('emptyFile');
  if (!accountAlias.trim() || /\d{5,}/.test(accountAlias)) throw new Error('invalidAlias');
  const normalized = headers.map(value => value.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('unsupportedColumns');
  const column = (...names: string[]) => normalized.findIndex(value => names.includes(value));
  const dateColumn = column('posting date', 'post date', 'date');
  const descriptionColumn = column('description', 'memo');
  const amountColumn = column('amount');
  const debitColumn = column('debit'); const creditColumn = column('credit');
  const directionColumn = column('details');
  if (dateColumn < 0 || descriptionColumn < 0 ||
      (amountColumn < 0 && (debitColumn < 0 || creditColumn < 0))) throw new Error('unsupportedColumns');
  if (amountColumn >= 0 && (debitColumn >= 0 || creditColumn >= 0)) throw new Error('unsupportedColumns');
  const rows: BankRow[] = []; const errors: StatementPreview['errors'] = [];
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const line = index + 2;
    try {
      if (record.length !== headers.length) throw new Error('columnMismatch');
      const date = isoDate(record[dateColumn]);
      const description = record[descriptionColumn].trim();
      if (!description) throw new Error('columnMismatch');
      let amountCents: number;
      if (amountColumn >= 0) amountCents = cents(record[amountColumn]);
      else {
        const debit = record[debitColumn].trim(); const credit = record[creditColumn].trim();
        if ((!debit && !credit) || (debit && credit && cents(debit) !== 0 && cents(credit) !== 0)) throw new Error('ambiguousDirection');
        const d = debit ? cents(debit) : 0; const c = credit ? cents(credit) : 0;
        if (d < 0 || c < 0) throw new Error('ambiguousDirection');
        amountCents = sumCents([c, -d]);
      }
      const issues: IssueCode[] = [];
      const direction = directionColumn >= 0 ? record[directionColumn].trim().toUpperCase() : '';
      if ((direction === 'DEBIT' && amountCents > 0) || (direction === 'CREDIT' && amountCents < 0)) issues.push('ambiguousDirection');
      const identity = JSON.stringify([date, description.toLowerCase(), amountCents]);
      // Identical legitimate transactions are possible: flag, do not silently drop.
      if (seen.has(identity)) issues.push('duplicateRow');
      seen.add(identity); rows.push({ line, date, description, amountCents, issues });
    } catch (error) {
      errors.push({ line, code: (error instanceof Error ? error.message : 'invalidAmount') as IssueCode });
    }
  });
  const dates = rows.map(row => row.date).sort();
  return { bank, accountAlias: accountAlias.trim(), rows, errors,
    adapter: bank === 'chase' && normalized.includes('posting date') && directionColumn >= 0 ? 'chase-csv' : 'mapped-csv',
    from: dates[0] || '', to: dates.at(-1) || '',
    creditsCents: sumCents(rows.filter(r => r.amountCents > 0).map(r => r.amountCents)),
    debitsCents: sumCents(rows.filter(r => r.amountCents < 0).map(r => -r.amountCents)) };
}

export const sampleStatement = 'Details,Posting Date,Description,Amount\nCREDIT,10/19/2026,STRIPE PAYOUT DEMO,606.25\nDEBIT,10/18/2026,FUEL DEMO,-45.00\nDEBIT,10/17/2026,INTERNET DEMO,-88.00\nDEBIT,10/16/2026,PARTS DEMO,-95.00\n';
