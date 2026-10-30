/**
 * گزارش‌ها و خروجی‌های کاربردی انبارگردانی
 */

import type { Product } from '@/types';
import { products, settings, session, isDoubleCount, logAudit } from './state';
import { toast } from './ui';
import { exportExcel, exportCSV, rowsToCSV, buildOfflineXlsx } from './import-export';
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

export function exportAccountingDoc(kind: 'generic' | 'heloo' | 'sepidar' = 'generic'): void {
  const list = activeList().filter(
    (p) => p.countedQty != null && p.countedQty !== p.systemQty
  );
  if (!list.length) {
    toast('مغایرتی برای سند اصلاح نیست', 'error');
    return;
  }

  if (kind === 'heloo') {
    const rows = list.map((p) => ({
      کد: p.sku || p.code || '',
      نام: p.name,
      'موجودی سیستم': p.systemQty,
      شمارش: p.countedQty,
      اختلاف: (p.countedQty ?? 0) - p.systemQty,
      انبار: p.warehouse || settings.currentWarehouse || '',
    }));
    downloadFile(rowsToCSV(rows), `heloo-adjust-${dateStr()}.csv`, 'text/csv;charset=utf-8');
    toast('خروجی قالب هلو آماده شد', 'success');
    return;
  }

  if (kind === 'sepidar') {
    const rows = list.map((p) => ({
      ItemCode: p.sku || p.code || '',
      ItemName: p.name,
      SystemQty: p.systemQty,
      CountedQty: p.countedQty,
      Diff: (p.countedQty ?? 0) - p.systemQty,
      Warehouse: p.warehouse || settings.currentWarehouse || '',
      Location: p.location || '',
    }));
    downloadFile(rowsToCSV(rows), `sepidar-adjust-${dateStr()}.csv`, 'text/csv;charset=utf-8');
    toast('خروجی قالب سپیدار آماده شد', 'success');
    return;
  }

  const rows = list.map((p) => ({
    بارکد: p.code || '',
    کد: p.sku || '',
    نام: p.name,
    'موجودی سیستم': p.systemQty,
    شمارش: p.countedQty,
    اختلاف: (p.countedQty ?? 0) - p.systemQty,
    'قیمت واحد': p.price || 0,
    'ارزش اختلاف': ((p.countedQty ?? 0) - p.systemQty) * (p.price || 0),
    محل: p.location || '',
    انبار: p.warehouse || '',
    یادداشت: p.note || '',
  }));
  downloadFile(rowsToCSV(rows), `inventory-adjust-${dateStr()}.csv`, 'text/csv;charset=utf-8');
  toast('سند اصلاح موجودی دانلود شد', 'success');
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
  const list = activeList().filter((p) => {
    const q = p.countedQty ?? p.systemQty ?? 0;
    if (p.minQty != null && q < p.minQty) return true;
    if (p.maxQty != null && q > p.maxQty) return true;
    return false;
  });
  if (!list.length) {
    toast('هشدار موجودی نیست', 'info');
    return;
  }
  const rows = list.map((p) => {
    const q = p.countedQty ?? p.systemQty ?? 0;
    let status = '';
    if (p.minQty != null && q < p.minQty) status = 'کم‌موجود';
    if (p.maxQty != null && q > p.maxQty) status = status ? status + '+بیش‌موجود' : 'بیش‌موجود';
    return {
      بارکد: p.code || '',
      نام: p.name,
      موجودی: q,
      حداقل: p.minQty ?? '',
      حداکثر: p.maxQty ?? '',
      وضعیت: status,
    };
  });
  downloadFile(rowsToCSV(rows), `stock-alerts-${dateStr()}.csv`, 'text/csv;charset=utf-8');
  toast(`${list.length} هشدار دانلود شد`, 'success');
}

export function copyTextReport(): void {
  const text = buildTextReport();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast('گزارش کپی شد', 'success'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('گزارش کپی شد', 'success');
  } catch {
    toast('کپی ممکن نشد', 'error');
  }
  document.body.removeChild(ta);
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
