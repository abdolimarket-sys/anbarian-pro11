/**
 * گزارش‌ها و خروجی‌های کاربردی انبارگردانی
 */

import type { Product } from '@/types';
import { products, settings, session, isDoubleCount, logAudit } from './state';
import { toast } from './ui';
import { exportExcel, rowsToCSV, buildOfflineXlsx } from './import-export';
import { downloadFile, dateStr, formatFaNumber } from '@/utils/helpers';
import { getOperatorName } from './storage';

export interface ReportSummary {
  total: number;
  counted: number;
  uncounted: number;
  diffs: number;
  over: number;
  under: number;
  match: number;
  withPhoto: number;
  progressPct: number;
  valueDiff: number;
}

export function computeSummary(list: Product[] = products): ReportSummary {
  let counted = 0;
  let diffs = 0;
  let over = 0;
  let under = 0;
  let match = 0;
  let withPhoto = 0;
  let valueDiff = 0;

  for (const p of list) {
    if (p.photo) withPhoto++;
    if (p.countedQty == null) continue;
    counted++;
    const d = p.countedQty - (p.systemQty ?? 0);
    if (d === 0) match++;
    else {
      diffs++;
      if (d > 0) over++;
      else under++;
      valueDiff += d * (p.price || 0);
    }
  }

  const total = list.length;
  return {
    total,
    counted,
    uncounted: total - counted,
    diffs,
    over,
    under,
    match,
    withPhoto,
    progressPct: total ? Math.round((counted / total) * 100) : 0,
    valueDiff,
  };
}

function activeList(): Product[] {
  const wh = settings.currentWarehouse;
  if (!wh || wh === 'همه') return products;
  return products.filter((p) => (p.warehouse || 'انبار اصلی') === wh);
}

export function buildTextReport(): string {
  const list = activeList();
  const s = computeSummary(list);
  const lines = [
    'گزارش انبارگردانی — انبارین',
    'تاریخ: ' + new Date().toLocaleString('fa-IR'),
    'اپراتور: ' + getOperatorName(),
    'انبار: ' + (settings.currentWarehouse || '—'),
    session ? 'جلسه: ' + session.id : 'بدون جلسه',
    '────────────────',
    `کل کالا: ${s.total}`,
    `شمارش‌شده: ${s.counted} (${s.progressPct}٪)`,
    `مانده: ${s.uncounted}`,
    `تطابق: ${s.match}`,
    `مغایرت: ${s.diffs} (بیش‌بود: ${s.over} / کسری: ${s.under})`,
    `ارزش مغایرت تقریبی: ${s.valueDiff.toLocaleString('fa-IR')}`,
    `با عکس: ${s.withPhoto}`,
  ];
  return lines.join('\n');
}

export function exportDiffsExcel(): void {
  exportExcel(true);
}

export function exportFullExcel(): void {
  exportExcel(false);
}


/** خروجی سبک برای نرم‌افزارهای مقصد: فقط بارکد و مقدار شمارش‌شده */
export function exportBarcodeQuantityExcel(): void {
  const list = activeList().filter((p) => p.countedQty != null);
  if (!list.length) {
    toast('کالای شمارش‌شده‌ای برای خروجی وجود ندارد', 'error');
    return;
  }

  // بارکد به‌صورت متن نوشته می‌شود تا صفرهای ابتدای آن حفظ شوند.
  const rows: unknown[][] = [
    ['بارکد', 'مقدار'],
    ...list.map((p) => [String(p.code || '').trim(), p.countedQty ?? 0]),
  ];

  try {
    const bytes = buildOfflineXlsx([{ name: 'بارکد و مقدار', rows }]);
    downloadFile(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `anbarin-barcode-quantity-${dateStr()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    toast(`اکسل بارکد و مقدار آماده شد (${list.length} ردیف)`, 'success');
    logAudit('export_barcode_quantity_xlsx', { count: list.length });
  } catch (error) {
    console.error('Barcode/quantity XLSX export failed', error);
    toast('ساخت فایل اکسل بارکد و مقدار ناموفق بود', 'error');
  }
}

export function exportAccountingDoc(kind: 'generic' | 'heloo' | 'sepidar' = 'generic'): void {
  const list = activeList().filter(
    (p) => p.countedQty != null && p.countedQty !== p.systemQty
  );
  if (!list.length) {
    toast('مغایرتی برای خروجی اکسل نیست', 'error');
    return;
  }

  const reportRows = list.map((p) => {
    const diff = (p.countedQty ?? 0) - (p.systemQty ?? 0);
    return {
      code: p.sku || p.code || '',
      barcode: p.code || '',
      name: p.name || '',
      warehouse: p.warehouse || settings.currentWarehouse || '',
      systemQty: p.systemQty ?? 0,
      countedQty: p.countedQty ?? 0,
      diff,
      unit: p.unit || '',
      unitPrice: p.price || 0,
      diffValue: diff * (p.price || 0),
      location: p.location || '',
      note: p.note || '',
    };
  });

  const summaryRows: unknown[][] = [
    ['عنوان', 'مقدار'],
    ['نرم‌افزار مقصد', kind === 'heloo' ? 'هلو' : kind === 'sepidar' ? 'سپیدار' : 'عمومی'],
    ['تاریخ تهیه گزارش', new Date().toLocaleDateString('fa-IR')],
    ['انبار انتخاب‌شده', settings.currentWarehouse || 'همه انبارها'],
    ['تعداد ردیف مغایرت', list.length],
    ['جمع اختلاف تعدادی', reportRows.reduce((sum, r) => sum + r.diff, 0)],
    ['جمع ارزش اختلاف', reportRows.reduce((sum, r) => sum + r.diffValue, 0)],
    ['توضیح', 'اختلاف = موجودی شمارش‌شده منهای موجودی سیستم؛ مقادیر مثبت بیش‌بود و منفی کسری است.'],
    ['نکته سازگاری', 'این فایل گزارش اکسل است. برای ورود مستقیم به نرم‌افزار، قالب رسمی متناسب با نسخه هلو/سپیدار را با نمونه خروجی آن نرم‌افزار تطبیق دهید.'],
  ];

  let sheets: Array<{ name: string; rows: unknown[][] }>;
  let filename: string;
  if (kind === 'heloo') {
    const headers = ['کد کالا', 'بارکد', 'نام کالا', 'انبار', 'موجودی سیستم', 'موجودی شمارش‌شده', 'اختلاف', 'واحد', 'قیمت واحد', 'ارزش اختلاف', 'محل / قفسه', 'توضیحات'];
    const rows = reportRows.map((r) => [r.code, r.barcode, r.name, r.warehouse, r.systemQty, r.countedQty, r.diff, r.unit, r.unitPrice, r.diffValue, r.location, r.note]);
    sheets = [{ name: 'گزارش هلو', rows: [headers, ...rows] }, { name: 'خلاصه گزارش', rows: summaryRows }];
    filename = `anbarin-heloo-report-${dateStr()}.xlsx`;
  } else if (kind === 'sepidar') {
    // شیت انگلیسی برای نگاشت ساده‌تر در نسخه‌هایی که نام ستون لاتین می‌پذیرند؛
    // شیت فارسی جداگانه نیز برای کنترل انسانی حفظ می‌شود.
    const headers = ['ItemCode', 'Barcode', 'ItemName', 'Warehouse', 'SystemQty', 'CountedQty', 'Difference', 'Unit', 'UnitPrice', 'DifferenceValue', 'Location', 'Description'];
    const rows = reportRows.map((r) => [r.code, r.barcode, r.name, r.warehouse, r.systemQty, r.countedQty, r.diff, r.unit, r.unitPrice, r.diffValue, r.location, r.note]);
    const faHeaders = ['کد کالا', 'بارکد', 'نام کالا', 'انبار', 'موجودی سیستم', 'موجودی شمارش‌شده', 'اختلاف', 'واحد', 'قیمت واحد', 'ارزش اختلاف', 'محل / قفسه', 'توضیحات'];
    const faRows = reportRows.map((r) => [r.code, r.barcode, r.name, r.warehouse, r.systemQty, r.countedQty, r.diff, r.unit, r.unitPrice, r.diffValue, r.location, r.note]);
    sheets = [{ name: 'Sepidar Data', rows: [headers, ...rows] }, { name: 'گزارش فارسی', rows: [faHeaders, ...faRows] }, { name: 'خلاصه گزارش', rows: summaryRows }];
    filename = `anbarin-sepidar-report-${dateStr()}.xlsx`;
  } else {
    const headers = ['بارکد', 'کد کالا', 'نام کالا', 'انبار', 'موجودی سیستم', 'شمارش', 'اختلاف', 'واحد', 'قیمت واحد', 'ارزش اختلاف', 'محل', 'یادداشت'];
    const rows = reportRows.map((r) => [r.barcode, r.code, r.name, r.warehouse, r.systemQty, r.countedQty, r.diff, r.unit, r.unitPrice, r.diffValue, r.location, r.note]);
    sheets = [{ name: 'گزارش مغایرت', rows: [headers, ...rows] }, { name: 'خلاصه گزارش', rows: summaryRows }];
    filename = `anbarin-inventory-adjust-${dateStr()}.xlsx`;
  }

  try {
    const bytes = buildOfflineXlsx(sheets);
    downloadFile(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      filename,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    toast(`فایل اکسل ${kind === 'heloo' ? 'هلو' : kind === 'sepidar' ? 'سپیدار' : 'عمومی'} آماده ذخیره است (${list.length} ردیف مغایرت)`, 'success');
    logAudit('export_accounting_xlsx', { kind, count: list.length });
  } catch (error) {
    console.error('Accounting XLSX export failed', error);
    toast('ساخت فایل اکسل ناموفق بود', 'error');
  }
}



export type AccountingTemplateKind = 'heloo' | 'sepidar';
type AccountingField = 'barcode' | 'name' | 'code' | 'systemQty' | 'countedQty' | 'diff' | 'unitPrice' | 'diffValue' | 'unit' | 'location';
const ACCOUNTING_FIELDS: Array<{ id: AccountingField; label: string }> = [
  { id: 'barcode', label: 'بارکد' },
  { id: 'name', label: 'نام کالا' },
  { id: 'code', label: 'کد کالا' },
  { id: 'systemQty', label: 'موجودی سیستم' },
  { id: 'countedQty', label: 'موجودی شمارش‌شده' },
  { id: 'diff', label: 'مغایرت' },
  { id: 'unitPrice', label: 'قیمت واحد' },
  { id: 'diffValue', label: 'ارزش مغایرت' },
  { id: 'unit', label: 'واحد کالا' },
  { id: 'location', label: 'محل کالا' },
];
const DEFAULT_ACCOUNTING_FIELDS: AccountingField[] = ACCOUNTING_FIELDS.map((f) => f.id);
const TEMPLATE_STORAGE_PREFIX = 'anbarin_accounting_template_v1_';

function getTemplate(kind: AccountingTemplateKind): AccountingField[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_PREFIX + kind);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((v): v is AccountingField => ACCOUNTING_FIELDS.some((f) => f.id === v));
        if (valid.length) return valid;
      }
    }
  } catch (e) { console.warn('Could not read accounting template', e); }
  return [...DEFAULT_ACCOUNTING_FIELDS];
}

export function initAccountingTemplateUI(): void {
  const target = document.getElementById('accountingTemplateTarget') as HTMLSelectElement | null;
  const fieldsHost = document.getElementById('accountingTemplateFields');
  if (!target || !fieldsHost || fieldsHost.dataset.initialized === '1') return;
  fieldsHost.dataset.initialized = '1';
  fieldsHost.innerHTML = ACCOUNTING_FIELDS.map((f) => `<label class="accounting-field-option" style="display:flex;align-items:center;gap:8px;padding:6px 2px"><input type="checkbox" data-accounting-field="${f.id}" checked><span>${f.label}</span></label>`).join('');

  const applyTemplate = () => {
    const selected = getTemplate(target.value as AccountingTemplateKind);
    fieldsHost.querySelectorAll<HTMLInputElement>('input[data-accounting-field]').forEach((el) => {
      el.checked = selected.includes(el.dataset.accountingField as AccountingField);
    });
  };
  target.addEventListener('change', applyTemplate);
  document.getElementById('btnSaveAccountingTemplate')?.addEventListener('click', () => {
    const chosen = Array.from(fieldsHost.querySelectorAll<HTMLInputElement>('input[data-accounting-field]:checked'))
      .map((el) => el.dataset.accountingField as AccountingField);
    if (!chosen.length) { toast('حداقل یک ستون را انتخاب کنید', 'error'); return; }
    try {
      localStorage.setItem(TEMPLATE_STORAGE_PREFIX + target.value, JSON.stringify(chosen));
      toast(`قالب ${target.value === 'heloo' ? 'هلو' : 'سپیدار'} ذخیره شد`, 'success');
      logAudit('save_accounting_template', { kind: target.value, fields: chosen });
    } catch (e) { console.error(e); toast('ذخیره قالب ناموفق بود', 'error'); }
  });
  document.getElementById('btnExportAccountingTemplate')?.addEventListener('click', () => {
    const chosen = Array.from(fieldsHost.querySelectorAll<HTMLInputElement>('input[data-accounting-field]:checked'))
      .map((el) => el.dataset.accountingField as AccountingField);
    if (!chosen.length) { toast('حداقل یک ستون را انتخاب کنید', 'error'); return; }
    exportConfiguredAccounting(target.value as AccountingTemplateKind, chosen);
  });
  applyTemplate();
}

function exportConfiguredAccounting(kind: AccountingTemplateKind, chosen: AccountingField[]): void {
  const list = activeList().filter((p) => p.countedQty != null);
  if (!list.length) { toast('کالای شمارش‌شده‌ای برای خروجی وجود ندارد', 'error'); return; }
  const labels: Record<AccountingField, string> = {
    barcode: 'بارکد', name: 'نام کالا', code: 'کد کالا', systemQty: 'موجودی سیستم',
    countedQty: 'موجودی شمارش‌شده', diff: 'مغایرت', unitPrice: 'قیمت واحد',
    diffValue: 'ارزش مغایرت', unit: 'واحد کالا', location: 'محل کالا',
  };
  const rows = list.map((p) => {
    const diff = (p.countedQty ?? 0) - (p.systemQty ?? 0);
    const values: Record<AccountingField, unknown> = {
      // Barcode is intentionally a string cell to preserve leading zeros.
      barcode: String(p.code ?? '').trim(),
      name: p.name ?? '',
      code: String(p.sku ?? p.code ?? '').trim(),
      systemQty: p.systemQty ?? 0,
      countedQty: p.countedQty ?? 0,
      diff,
      unitPrice: p.price ?? 0,
      diffValue: diff * (p.price ?? 0),
      unit: p.unit ?? '',
      location: p.location ?? '',
    };
    return chosen.map((field) => values[field]);
  });
  const headers = chosen.map((field) => labels[field]);
  const filename = `anbarin-${kind === 'heloo' ? 'heloo' : 'sepidar'}-custom-${dateStr()}.xlsx`;
  try {
    const bytes = buildOfflineXlsx([{ name: kind === 'heloo' ? 'خروجی هلو' : 'خروجی سپیدار', rows: [headers, ...rows] }]);
    downloadFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(`فایل اکسل ساخته شد؛ ${list.length} کالا و ${chosen.length} ستون`, 'success');
    logAudit('export_accounting_custom_xlsx', { kind, count: list.length, fields: chosen });
  } catch (error) {
    console.error('Custom accounting XLSX export failed', error);
    toast('ساخت فایل اکسل ناموفق بود', 'error');
  }
}

export function exportDoubleCountMismatches(): void {
  if (!isDoubleCount()) {
    toast('شمارش دوفازی فعال نیست', 'info');
    return;
  }
  const list = activeList().filter((p) => {
    if (p.countedQty == null || p.countedQty2 == null) return false;
    return p.countedQty !== p.countedQty2;
  });
  if (!list.length) {
    toast('اختلافی بین فاز ۱ و ۲ نیست', 'info');
    return;
  }
  const rows = list.map((p) => ({
    بارکد: p.code || '',
    نام: p.name,
    'شمارش ۱': p.countedQty,
    'شمارش ۲': p.countedQty2,
    اختلاف: (p.countedQty2 ?? 0) - (p.countedQty ?? 0),
    سیستم: p.systemQty,
    محل: p.location || '',
  }));
  downloadFile(rowsToCSV(rows), `double-count-diff-${dateStr()}.csv`, 'text/csv;charset=utf-8');
  toast(`${list.length} اختلاف فاز دانلود شد`, 'success');
}

export function exportStockAlerts(): void {
  const list = activeList();
  const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  };

  // فقط کالاهایی که حداقل یک حد موجودی معتبر دارند، قابل بررسی برای هشدار هستند.
  const configured = list.filter((p) => toFiniteNumber(p.minQty) !== null || toFiniteNumber(p.maxQty) !== null);
  if (!configured.length) {
    toast('حداقل یا حداکثر موجودی برای هیچ کالایی تنظیم نشده است؛ ابتدا در مشخصات کالا مقدار حداقل/حداکثر را وارد کن', 'info');
    return;
  }

  const alerts = configured.flatMap((p) => {
    const q = toFiniteNumber(p.countedQty) ?? toFiniteNumber(p.systemQty) ?? 0;
    const min = toFiniteNumber(p.minQty);
    const max = toFiniteNumber(p.maxQty);
    const low = min !== null && q < min;
    const high = max !== null && q > max;
    if (!low && !high) return [];
    const status = low && high ? 'کم‌موجود و بیش‌موجود (بررسی حدود)' : low ? 'کم‌موجود' : 'بیش‌موجود';
    return [{
      barcode: String(p.code ?? '').trim(),
      name: p.name ?? '',
      quantity: q,
      minimum: min ?? '',
      maximum: max ?? '',
      status,
      sku: String(p.sku ?? '').trim(),
      unit: p.unit ?? '',
      warehouse: p.warehouse ?? '',
      location: p.location ?? '',
    }];
  });

  if (!alerts.length) {
    toast(`هشدار موجودی پیدا نشد؛ حدود ${configured.length} کالا بررسی شد`, 'success');
    return;
  }

  // خروجی XLSX واقعی؛ بارکد عمداً به‌صورت رشته نوشته می‌شود تا صفر ابتدایی حفظ شود.
  const rows: unknown[][] = [
    ['بارکد', 'نام کالا', 'کد کالا', 'موجودی فعلی', 'حداقل موجودی', 'حداکثر موجودی', 'وضعیت', 'واحد', 'انبار', 'محل'],
    ...alerts.map((a) => [a.barcode, a.name, a.sku, a.quantity, a.minimum, a.maximum, a.status, a.unit, a.warehouse, a.location]),
  ];

  try {
    const bytes = buildOfflineXlsx([{ name: 'هشدار موجودی', rows }]);
    downloadFile(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `anbarin-stock-alerts-${dateStr()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    toast(`${alerts.length} هشدار موجودی در فایل اکسل آماده شد`, 'success');
    logAudit('export_stock_alerts_xlsx', { count: alerts.length, configured: configured.length });
  } catch (error) {
    console.error('Stock alerts XLSX export failed', error);
    toast('ساخت فایل اکسل هشدار موجودی ناموفق بود', 'error');
  }
}

export function copyTextReport(): void {
  let text = '';
  try {
    text = buildTextReport().trim();
  } catch (error) {
    console.error('Building text report failed', error);
    toast('ساخت خلاصه گزارش ناموفق بود', 'error');
    return;
  }

  if (!text) {
    toast('خلاصه گزارشی برای کپی وجود ندارد', 'error');
    return;
  }

  // Clipboard API در مرورگرهای امن اولویت دارد؛ در WebView اندروید ممکن است در دسترس نباشد.
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(
        () => toast('خلاصه گزارش کپی شد؛ حالا آن را در برنامه مقصد جای‌گذاری کنید', 'success'),
        (error) => {
          console.warn('Clipboard API rejected the copy request', error);
          toast('کپی خودکار انجام نشد؛ مجوز کلیپ‌بورد یا اجرای برنامه را بررسی کنید', 'error');
        }
      );
      return;
    }
  } catch (error) {
    console.warn('Clipboard API unavailable', error);
  }

  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);

  let copied = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    copied = document.execCommand('copy') === true;
  } catch (error) {
    console.error('Fallback clipboard copy failed', error);
  } finally {
    ta.remove();
  }

  if (copied) {
    toast('خلاصه گزارش کپی شد؛ در برنامه مقصد جای‌گذاری کنید', 'success');
  } else {
    toast('کپی خودکار در این دستگاه پشتیبانی نشد؛ گزارش را از نسخه وب باز کنید یا قابلیت کپی سیستم را فعال کنید', 'error');
  }
}

export function renderReportHTML(): string {
  const s = computeSummary(activeList());
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.total)}</div><div class="stat-label">کل</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.counted)}</div><div class="stat-label">شمارش‌شده</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.uncounted)}</div><div class="stat-label">مانده</div></div>
      <div class="stat-card"><div class="stat-value">${s.progressPct}٪</div><div class="stat-label">پیشرفت</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.match)}</div><div class="stat-label">تطابق</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.diffs)}</div><div class="stat-label">مغایرت</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.over)}</div><div class="stat-label">بیش‌بود</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(s.under)}</div><div class="stat-label">کسری</div></div>
    </div>
    <p class="hint" style="margin-top:12px">ارزش تقریبی مغایرت: <strong>${s.valueDiff.toLocaleString('fa-IR')}</strong></p>
  `;
}
