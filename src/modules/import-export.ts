/**
 * ماژول Import / Export
 * - CSV (خواندن و نوشتن، UTF-8 BOM)
 * - XLSX با SheetJS اگر موجود باشد
 * - XLSX آفلاین ساده (بدون کتابخانه) برای خروجی
 * - JSON backup
 * - نگاشت هوشمند ستون‌های فارسی
 */

import type { Product } from '@/types';
import { products, settings, logAudit, save, rebuildIndex, invalidateStats } from './state';
import { toast } from './ui';
import { setLocationFilter, collectLocations } from './filters-roles';
import { downloadFile, dateStr, generateId, normalizeDigits } from '@/utils/helpers';

declare global {
  interface Window {
    XLSX?: any;
  }
}

export type ImportMode = 'merge' | 'replace';

export interface ImportRow {
  name?: string;
  code?: string;
  sku?: string;
  unit?: string;
  systemQty?: number;
  price?: number;
  location?: string;
  warehouse?: string;
  note?: string;
  serial?: string;
  batch?: string;
  expiry?: string;
  minQty?: number | null;
  maxQty?: number | null;
  unitFactor?: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

// ——— Header normalization & mapping ———

const HEADER_ALIASES: Record<string, keyof ImportRow | 'qty' | 'counted'> = {
  // name
  name: 'name',
  نام: 'name',
  نامکالا: 'name',
  کالا: 'name',
  product: 'name',
  productname: 'name',
  title: 'name',
  // code / barcode
  code: 'code',
  barcode: 'code',
  barcod: 'code',
  بارکد: 'code',
  بارکدکالا: 'code',
  کدبارکد: 'code',
  ean: 'code',
  // sku
  sku: 'sku',
  کد: 'sku',
  کدکالا: 'sku',
  کدسیستمی: 'sku',
  itemcode: 'sku',
  // qty
  qty: 'qty',
  quantity: 'qty',
  موجودی: 'qty',
  موجودیسیستم: 'qty',
  تعدادسیستم: 'qty',
  systemqty: 'qty',
  stock: 'qty',
  // counted
  counted: 'counted',
  شمارش: 'counted',
  تعداد: 'counted',
  countedqty: 'counted',
  // unit
  unit: 'unit',
  واحد: 'unit',
  واحداندازهگیری: 'unit',
  // price
  price: 'price',
  قیمت: 'price',
  فی: 'price',
  قیمتواحد: 'price',
  // location
  location: 'location',
  محل: 'location',
  مکان: 'location',
  قفسه: 'location',
  جایگاه: 'location',
  // warehouse
  warehouse: 'warehouse',
  انبار: 'warehouse',
  // note
  note: 'note',
  یادداشت: 'note',
  توضیحات: 'note',
  شرح: 'note',
  // serial / batch / expiry
  serial: 'serial',
  سریال: 'serial',
  batch: 'batch',
  بچ: 'batch',
  سریساخت: 'batch',
  expiry: 'expiry',
  انقضا: 'expiry',
  تاریخانقضا: 'expiry',
};

export function normalizeImportHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\u200c/g, '')
    .replace(/[^a-z0-9آ-ی]/g, '');
}

export function mapHeaders(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  headers.forEach((h, i) => {
    const key = normalizeImportHeader(h);
    const field = HEADER_ALIASES[key];
    if (field) map[i] = field;
  });
  return map;
}

function parseNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/,/g, '')
    .replace(/٫/g, '.')
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ——— CSV ———

export function parseCSVText(text: string): string[][] {
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/)[0] || '';
  const delimiter = first.split(';').length > first.split(',').length ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') quoted = true;
      else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        cell = '';
        if (row.some((c) => c.trim() !== '')) rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // skip
      } else {
        cell += ch;
      }
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function rowsToCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return (
    '\uFEFF' +
    keys.map(q).join(',') +
    '\r\n' +
    rows.map((r) => keys.map((k) => q(r[k])).join(',')).join('\r\n')
  );
}

export function exportCSV(onlyDiff = false): void {
  if (!products.length) {
    toast('کالایی نیست', 'error');
    return;
  }
  let list = onlyDiff
    ? products.filter((p) => p.countedQty !== null && p.countedQty !== p.systemQty)
    : products;
  if (!list.length) {
    toast('موردی برای خروجی نیست', 'error');
    return;
  }
  const data = list.map(productToExportRow);
  downloadFile(rowsToCSV(data), `anbar-${onlyDiff ? 'diff-' : ''}${dateStr()}.csv`, 'text/csv;charset=utf-8');
  toast('در حال آماده‌سازی ذخیره فایل CSV', 'success');
  logAudit('export_csv', { count: list.length, onlyDiff });
}

// ——— JSON backup ———

export function exportJSON(): void {
  const payload = {
    type: 'anbar-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    warehouse: settings.currentWarehouse,
    products,
    settings,
  };
  downloadFile(
    JSON.stringify(payload, null, 2),
    `anbar-backup-${dateStr()}.json`,
    'application/json'
  );
  toast('پنجره انتخاب محل ذخیره پشتیبان باز می‌شود', 'success');
  logAudit('export_json', { count: products.length });
}

export async function importJSONFile(file: File): Promise<ImportResult | null> {
  const text = await file.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    toast('فایل JSON معتبر نیست', 'error');
    return null;
  }
  if (!data || !Array.isArray(data.products)) {
    toast('ساختار پشتیبان نامعتبر است', 'error');
    return null;
  }
  const mode = await askImportMode();
  if (!mode) return null;

  if (mode === 'replace') {
    products.length = 0;
    products.push(...data.products);
    rebuildIndex();
    save(true);
    invalidateStats();
    logAudit('import_json', { mode: 'replace', count: data.products.length });
    toast(`${data.products.length} کالا جایگزین شد`, 'success');
    return { added: data.products.length, updated: 0, skipped: 0, total: data.products.length };
  }

  return applyImportRows(
    data.products.map((p: Product) => ({
      name: p.name,
      code: p.code,
      sku: p.sku,
      unit: p.unit,
      systemQty: p.systemQty,
      price: p.price,
      location: p.location,
      warehouse: p.warehouse,
      note: p.note,
      serial: p.serial,
      batch: p.batch,
      expiry: p.expiry,
    })),
    'merge'
  );
}

// ——— Product row helpers ———

function productToExportRow(p: Product): Record<string, unknown> {
  return {
    'بارکد کالا': p.code || '',
    'نام کالا': p.name,
    تعداد: p.countedQty !== null && p.countedQty !== undefined ? p.countedQty : '',
    'موجودی سیستم': p.systemQty,
    'شمارش ۱': p.countedQty !== null && p.countedQty !== undefined ? p.countedQty : '',
    'شمارش ۲': p.countedQty2 != null ? p.countedQty2 : '',
    مغایرت:
      p.countedQty !== null && p.countedQty !== undefined ? p.countedQty - p.systemQty : '',
    'قیمت واحد': p.price || 0,
    'ارزش مغایرت':
      p.countedQty !== null && p.countedQty !== undefined
        ? (p.countedQty - p.systemQty) * (p.price || 0)
        : '',
    یادداشت: p.note || '',
    محل: p.location || '',
    انبار: p.warehouse || '',
    سریال: p.serial || '',
    بچ: p.batch || '',
    انقضا: p.expiry || '',
    واحد: p.unit || '',
  };
}

const IMPORT_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'نادیده بگیر' },
  { value: 'name', label: 'نام کالا' },
  { value: 'code', label: 'بارکد' },
  { value: 'sku', label: 'کد کالا' },
  { value: 'qty', label: 'موجودی سیستم' },
  { value: 'counted', label: 'تعداد شمارش‌شده' },
  { value: 'unit', label: 'واحد' },
  { value: 'price', label: 'قیمت' },
  { value: 'location', label: 'محل / قفسه' },
  { value: 'warehouse', label: 'انبار' },
  { value: 'note', label: 'یادداشت' },
  { value: 'serial', label: 'سریال' },
  { value: 'batch', label: 'سری ساخت' },
  { value: 'expiry', label: 'تاریخ انقضا' },
  { value: 'minQty', label: 'حداقل موجودی' },
  { value: 'maxQty', label: 'حداکثر موجودی' },
  { value: 'unitFactor', label: 'ضریب واحد' },
];

function chooseColumnMapping(headers: string[]): Promise<Record<number, string> | null> {
  return new Promise((resolve) => {
    const previous = document.getElementById('importColumnMapping');
    previous?.remove();
    const detected = mapHeaders(headers);
    const overlay = document.createElement('div');
    overlay.id = 'importColumnMapping';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0009;display:flex;align-items:center;justify-content:center;padding:14px;';
    const card = document.createElement('div');
    card.dir = 'rtl';
    card.style.cssText = 'width:min(620px,100%);max-height:85vh;overflow:auto;background:var(--card,#fff);color:var(--text,#222);border-radius:16px;padding:18px;box-shadow:0 12px 40px #0004;';
    const title = document.createElement('h3'); title.textContent = 'تشخیص و انتخاب ستون‌های اکسل';
    title.style.cssText = 'margin-bottom:6px;font-size:1.1rem;';
    const intro = document.createElement('p'); intro.textContent = 'ستون‌ها به‌صورت خودکار تشخیص داده شده‌اند. در صورت نیاز، نوع هر ستون را تغییر دهید.';
    intro.style.cssText = 'font-size:.9rem;color:var(--text-soft,#666);margin-bottom:12px;';
    const form = document.createElement('div'); form.style.cssText = 'display:grid;gap:9px;';
    const selects: HTMLSelectElement[] = [];
    headers.forEach((header, i) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,.9fr);gap:10px;align-items:center;padding:8px;border:1px solid var(--border,#ddd);border-radius:10px;';
      const name = document.createElement('span'); name.textContent = `${header.trim() || `ستون ${i + 1}`} (${i + 1})`; name.style.cssText = 'overflow-wrap:anywhere;font-size:.9rem;';
      const select = document.createElement('select'); select.style.cssText = 'width:100%;min-width:0;padding:8px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--bg,#fff);color:var(--text,#222);';
      IMPORT_FIELD_OPTIONS.forEach((opt) => { const option = document.createElement('option'); option.value = opt.value; option.textContent = opt.label; select.appendChild(option); });
      const guessed = detected[i] || '';
      select.value = guessed;
      selects.push(select); row.append(name, select); form.appendChild(row);
    });
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;margin-top:16px;';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'انصراف';
    cancel.style.cssText = 'flex:1;padding:11px;border:1px solid var(--border,#ccc);border-radius:10px;background:transparent;color:inherit;font:inherit;';
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'ادامه وارد کردن';
    apply.style.cssText = 'flex:1;padding:11px;border:0;border-radius:10px;background:#0d9488;color:white;font-weight:700;font:inherit;';
    actions.append(cancel, apply); card.append(title, intro, form, actions); overlay.appendChild(card); document.body.appendChild(overlay);
    const finish = (value: Record<number, string> | null) => { overlay.remove(); resolve(value); };
    cancel.onclick = () => finish(null);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) finish(null); });
    apply.onclick = () => {
      const mapping: Record<number, string> = {};
      selects.forEach((select, i) => { if (select.value) mapping[i] = select.value; });
      if (!Object.values(mapping).some((v) => ['name', 'code', 'sku'].includes(v))) {
        toast('حداقل ستون نام کالا، بارکد یا کد کالا را انتخاب کنید', 'error'); return;
      }
      finish(mapping);
    };
  });
}

async function matrixToMappedImportRows(matrix: unknown[][]): Promise<ImportRow[] | null> {
  if (!matrix.length) return [];
  const headers = matrix[0].map((h) => String(h ?? ''));
  const mapping = await chooseColumnMapping(headers);
  return mapping ? matrixToImportRows(matrix, mapping) : null;
}

function matrixToImportRows(matrix: unknown[][], suppliedMap?: Record<number, string>): ImportRow[] {
  if (!matrix.length) return [];
  const headers = matrix[0].map((h) => String(h ?? ''));
  const colMap = suppliedMap || mapHeaders(headers);
  const rows: ImportRow[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || !line.some((c) => String(c ?? '').trim() !== '')) continue;

    const row: ImportRow = {};
    let hasNameOrCode = false;

    Object.entries(colMap).forEach(([idxStr, field]) => {
      const idx = Number(idxStr);
      const raw = line[idx];
      if (field === 'qty') {
        row.systemQty = parseNumber(raw);
      } else if (field === 'counted') {
        // ignore on import of master list, or could set countedQty — skip for master import
      } else if (field === 'price' || field === 'unitFactor') {
        (row as any)[field] = parseNumber(raw);
      } else if (field === 'minQty' || field === 'maxQty') {
        const n = parseNumber(raw);
        (row as any)[field] = isNaN(n) ? null : n;
      } else {
        const s = String(raw ?? '').trim();
        if (s) {
          (row as any)[field] = field === 'code' || field === 'sku' ? normalizeDigits(s) : s;
          if (field === 'name' || field === 'code' || field === 'sku') hasNameOrCode = true;
        }
      }
    });

    if (!row.name && (row.code || row.sku)) {
      row.name = 'کالای ' + (row.code || row.sku);
      hasNameOrCode = true;
    }
    if (hasNameOrCode) rows.push(row);
  }
  return rows;
}

function importIdentity(row: ImportRow): string {
  const code = normalizeDigits(row.code || '').toLowerCase();
  const sku = String(row.sku || '')
    .trim()
    .toLowerCase();
  const name = normalizeImportHeader(row.name || '');
  return code ? `b:${code}` : sku ? `s:${sku}` : name ? `n:${name}` : '';
}

export function applyImportRows(rows: ImportRow[], mode: ImportMode): ImportResult {
  if (mode === 'replace') {
    products.length = 0;
  }

  // index existing
  const byKey = new Map<string, number>();
  products.forEach((p, i) => {
    if (p.code) byKey.set(`b:${normalizeDigits(p.code).toLowerCase()}`, i);
    if (p.sku) byKey.set(`s:${normalizeDigits(p.sku).toLowerCase()}`, i);
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const key = importIdentity(row);
    if (!key) {
      skipped++;
      continue;
    }

    const existingIdx = byKey.get(key);
    if (existingIdx !== undefined && mode === 'merge') {
      const p = products[existingIdx];
      if (row.name) p.name = row.name;
      if (row.code) p.code = normalizeDigits(row.code);
      if (row.sku) p.sku = row.sku;
      if (row.unit) p.unit = row.unit;
      if (row.systemQty !== undefined) p.systemQty = row.systemQty;
      if (row.price !== undefined) p.price = row.price;
      if (row.location) p.location = row.location;
      if (row.warehouse) p.warehouse = row.warehouse;
      if (row.note) p.note = row.note;
      if (row.serial) p.serial = row.serial;
      if (row.batch) p.batch = row.batch;
      if (row.expiry) p.expiry = row.expiry;
      updated++;
    } else {
      const p: Product = {
        id: generateId('p'),
        name: row.name || 'بدون‌نام',
        code: normalizeDigits(row.code || row.sku || ''),
        sku: row.sku || '',
        unit: row.unit || 'عدد',
        unitFactor: row.unitFactor || 1,
        systemQty: row.systemQty ?? 0,
        countedQty: null,
        price: row.price || 0,
        location: row.location || '',
        warehouse: row.warehouse || settings.currentWarehouse || 'انبار اصلی',
        note: row.note || '',
        serial: row.serial || '',
        batch: row.batch || '',
        expiry: row.expiry || '',
        minQty: row.minQty ?? null,
        maxQty: row.maxQty ?? null,
        createdAt: new Date().toISOString(),
      };
      products.push(p);
      const i = products.length - 1;
      if (p.code) byKey.set(`b:${normalizeDigits(p.code).trim().toLowerCase()}`, i);
      if (p.sku) byKey.set(`s:${normalizeDigits(p.sku).trim().toLowerCase()}`, i);
      added++;
    }
  }

  rebuildIndex();
  save(true);
  invalidateStats();
  logAudit('import', { mode, added, updated, skipped, count: rows.length });
  toast(
    mode === 'replace'
      ? `${added} کالا جایگزین شد`
      : `ورود: ${added} جدید، ${updated} به‌روز` + (skipped ? `، ${skipped} رد` : ''),
    'success'
  );
  try {
    suggestLocationAfterImport(rows);
  } catch (e) {
    console.warn('suggestLocationAfterImport', e);
  }
  return { added, updated, skipped, total: rows.length };
}

function askImportMode(): Promise<ImportMode | null> {
  return new Promise((resolve) => {
    // ساده: confirm برای replace، در غیر این صورت merge
    // UI کامل‌تر بعداً اضافه می‌شود
    const hasData = products.length > 0;
    if (!hasData) {
      resolve('replace');
      return;
    }
    const replace = confirm(
      'کالاهایی از قبل وجود دارد.\n\nOK = ادغام با فهرست فعلی\nCancel = انصراف\n\n(برای جایگزینی کامل، ابتدا پشتیبان بگیرید و از دکمه جایگزینی استفاده کنید)'
    );
    resolve(replace ? 'merge' : null);
  });
}

// ——— File processing ———

export async function processImportFile(
  file: File,
  mode?: ImportMode
): Promise<ImportResult | null> {
  const fname = file.name.toLowerCase();

  if (/\.json$/i.test(fname)) {
    return importJSONFile(file);
  }

  if (/\.(csv|txt)$/i.test(fname)) {
    const text = await file.text();
    const matrix = parseCSVText(text);
    const rows = await matrixToMappedImportRows(matrix);
    if (rows === null) return null;
    if (!rows.length) {
      toast('ردیف معتبری در CSV پیدا نشد', 'error');
      return null;
    }
    const m = mode || (await askImportMode());
    if (!m) return null;
    return applyImportRows(rows, m);
  }

  // XLSX / XLS
  if (/\.(xlsx|xls)$/i.test(fname)) {
    return processExcelFile(file, mode);
  }

  toast('فرمت فایل پشتیبانی نمی‌شود (xlsx, xls, csv, json)', 'error');
  return null;
}

async function processExcelFile(
  file: File,
  mode?: ImportMode
): Promise<ImportResult | null> {
  const buf = await file.arrayBuffer();

  // Prefer SheetJS if loaded
  if (window.XLSX) {
    try {
      const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const matrix: unknown[][] = window.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
      });
      const rows = await matrixToMappedImportRows(matrix);
      if (rows === null) return null;
      if (!rows.length) {
        toast('ردیف معتبری پیدا نشد', 'error');
        return null;
      }
      const m = mode || (await askImportMode());
      if (!m) return null;
      return applyImportRows(rows, m);
    } catch (err) {
      console.error(err);
      toast('خطا در خواندن اکسل', 'error');
      return null;
    }
  }

  // Minimal offline XLSX reader for simple files is complex;
  // instruct user or fall back
  toast(
    'برای فایل اکسل، کتابخانه XLSX لازم است. فایل را به CSV UTF-8 تبدیل کنید یا صفحه را با xlsx.full.min.js باز کنید.',
    'error'
  );
  return null;
}

// ——— Offline XLSX writer (no external lib) ———

function xlsxEsc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xlsxCol(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xlsxSheetXml(rows: unknown[][]): string {
  const xmlRows = rows
    .map((row, ri) => {
      const cells = (row as unknown[])
        .map((v, ci) => {
          const ref = xlsxCol(ci + 1) + (ri + 1);
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}"><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xlsxEsc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
}

function xlsxCrc32(bytes: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function xlsxU16(n: number): number[] {
  return [n & 255, (n >>> 8) & 255];
}
function xlsxU32(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
function xlsxJoin(parts: number[][]): Uint8Array {
  let size = 0;
  for (const a of parts) size += a.length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (const a of parts) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

function rowsToSheet(objs: Record<string, unknown>[]): unknown[][] {
  if (!objs.length) return [['']];
  const keys = Object.keys(objs[0]);
  return [keys, ...objs.map((o) => keys.map((k) => o[k] ?? ''))];
}

/** ساخت فایل XLSX کاملاً آفلاین (بدون فشرده‌سازی) */
export function buildOfflineXlsx(
  sheets: Array<{ name: string; rows: unknown[][] }>
): Uint8Array {
  const enc = new TextEncoder();
  const clean = sheets.slice(0, 20).map((sh, i) => ({
    name: String(sh.name || 'Sheet' + (i + 1))
      .replace(/[\\/*?:\[\]]/g, ' ')
      .slice(0, 31) || 'Sheet' + (i + 1),
    rows: sh.rows || [],
  }));
  if (!clean.length) throw new Error('No sheets');

  const files: Array<[string, string]> = [];
  const overrides = clean
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  files.push([
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`,
  ]);
  files.push([
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  ]);

  const sheetRels = clean
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('');
  files.push([
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}</Relationships>`,
  ]);

  const sheetEntries = clean
    .map(
      (sh, i) =>
        `<sheet name="${xlsxEsc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('');
  files.push([
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`,
  ]);

  clean.forEach((sh, i) => {
    files.push([`xl/worksheets/sheet${i + 1}.xml`, xlsxSheetXml(sh.rows)]);
  });

  // Build ZIP (store only)
  const localParts: number[][] = [];
  const centralParts: number[][] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Array.from(enc.encode(name));
    const dataBytes = Array.from(enc.encode(content));
    const crc = xlsxCrc32(new Uint8Array(dataBytes));
    const local = [
      ...xlsxU32(0x04034b50),
      ...xlsxU16(20),
      ...xlsxU16(0),
      ...xlsxU16(0), // method store
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU32(crc),
      ...xlsxU32(dataBytes.length),
      ...xlsxU32(dataBytes.length),
      ...xlsxU16(nameBytes.length),
      ...xlsxU16(0),
      ...nameBytes,
      ...dataBytes,
    ];
    const central = [
      ...xlsxU32(0x02014b50),
      ...xlsxU16(20),
      ...xlsxU16(20),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU32(crc),
      ...xlsxU32(dataBytes.length),
      ...xlsxU32(dataBytes.length),
      ...xlsxU16(nameBytes.length),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU16(0),
      ...xlsxU32(0),
      ...xlsxU32(offset),
      ...nameBytes,
    ];
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const end = [
    ...xlsxU32(0x06054b50),
    ...xlsxU16(0),
    ...xlsxU16(0),
    ...xlsxU16(files.length),
    ...xlsxU16(files.length),
    ...xlsxU32(centralSize),
    ...xlsxU32(centralStart),
    ...xlsxU16(0),
  ];

  return xlsxJoin([...localParts, ...centralParts, end]);
}

export function exportExcel(onlyDiff = false): void {
  if (!products.length) {
    toast('کالایی نیست', 'error');
    return;
  }
  let list = onlyDiff
    ? products.filter((p) => p.countedQty !== null && p.countedQty !== p.systemQty)
    : products;
  if (!list.length) {
    toast('موردی برای خروجی نیست', 'error');
    return;
  }

  const data = list.map(productToExportRow);
  const filename = `anbar-${onlyDiff ? 'diff-' : ''}${dateStr()}.xlsx`;

  // Prefer SheetJS
  if (window.XLSX) {
    try {
      const ws = window.XLSX.utils.json_to_sheet(data);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, onlyDiff ? 'مغایرت‌ها' : 'انبارگردانی');
      // در اندروید از همان پنجره «ذخیره در» استفاده کن تا کاربر محل را انتخاب کند.
      // XLSX.writeFile مستقیماً دانلود می‌کند و انتخاب محل ذخیره را دور می‌زند.
      const workbookBytes = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadFile(
        new Blob([workbookBytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        filename,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      toast('پنجره انتخاب محل ذخیره فایل باز می‌شود', 'success');
      logAudit('export_xlsx', { count: list.length, onlyDiff, engine: 'sheetjs' });
      return;
    } catch (err) {
      console.warn('SheetJS export failed, fallback offline', err);
    }
  }

  // Offline fallback
  try {
    const bytes = buildOfflineXlsx([
      { name: onlyDiff ? 'مغایرت‌ها' : 'انبارگردانی', rows: rowsToSheet(data) },
    ]);
    downloadFile(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename
    );
    toast('پنجره انتخاب محل ذخیره فایل اکسل باز می‌شود', 'success');
    logAudit('export_xlsx', { count: list.length, onlyDiff, engine: 'offline' });
  } catch (err) {
    console.error(err);
    toast('خطا در ساخت اکسل', 'error');
  }
}

/** بارگذاری اختیاری SheetJS از public */
export function loadSheetJS(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.XLSX) {
      resolve(true);
      return;
    }
    const s = document.createElement('script');
    s.src = './xlsx.full.min.js';
    s.onload = () => resolve(!!window.XLSX);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** بعد از ورود فایل: پیشنهاد تنظیم فیلتر روی محل‌های واردشده */
export function suggestLocationAfterImport(rows: ImportRow[]): void {
  const locs = Array.from(
    new Set(
      rows
        .map((r) => (r.location || '').trim())
        .filter(Boolean)
    )
  );
  if (!locs.length) return;

  if (locs.length === 1) {
    const loc = locs[0];
    if (confirm(`محل «${loc}» در فایل وجود دارد.\nفیلتر لیست روی همین محل گذاشته شود؟`)) {
      setLocationFilter(loc);
      const a = document.getElementById('locationFilterSelect') as HTMLSelectElement | null;
      const b = document.getElementById('locationFilterSelectProducts') as HTMLSelectElement | null;
      if (a) {
        if (![...a.options].some((o) => o.value === loc)) {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          a.appendChild(opt);
        }
        a.value = loc;
      }
      if (b) {
        if (![...b.options].some((o) => o.value === loc)) {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          b.appendChild(opt);
        }
        b.value = loc;
      }
      toast('فیلتر محل: ' + loc, 'success');
    }
    return;
  }

  // چند محل
  const preview = locs.slice(0, 5).join('، ') + (locs.length > 5 ? '…' : '');
  toast(`فایل شامل ${locs.length} محل است: ${preview}`, 'info');
}

