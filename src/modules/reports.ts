/**
 * گزارش‌ها و خروجی‌های کاربردی انبارگردانی
 */

import type { Product } from '@/types';
import { products, settings, session, isDoubleCount } from './state';
import { toast } from './ui';
import { exportExcel, exportCSV, rowsToCSV } from './import-export';
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
