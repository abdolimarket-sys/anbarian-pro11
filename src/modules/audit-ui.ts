/**
 * نمایش و خروجی لاگ عملیات (Audit)
 * ارتقا: فیلتر، جستجو، خروجی CSV، پاک‌سازی کنترل‌شده
 */

import { auditLog, logAudit, save } from './state';
import { saveAuditLog } from './storage';
import { toast } from './ui';
import { formatAuditTime, downloadFile, dateStr, esc } from '@/utils/helpers';
import { rowsToCSV } from './import-export';

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    count: 'شمارش',
    count2: 'شمارش فاز ۲',
    undo: 'برگشت',
    import: 'ورود کالا',
    import_json: 'ورود JSON',
    export_csv: 'خروجی CSV',
    export_json: 'پشتیبان JSON',
    export_xlsx: 'خروجی اکسل',
    export_photos: 'خروجی عکس',
    import_photos: 'ورود عکس',
    photo: 'ثبت عکس',
    session: 'جلسه جدید',
    close_session: 'بستن جلسه',
    session_join: 'پیوستن به جلسه',
    team_export: 'ارسال تیم',
    team_import: 'ادغام تیم',
    partial_export: 'خروجی جزئی',
    merge: 'ادغام جزئی',
    product_add: 'افزودن کالا',
    product_edit: 'ویرایش کالا',
    product_delete: 'حذف کالا',
    clear_counts: 'پاک کردن شمارش‌ها',
    bulk_zero: 'صفر کردن مانده',
    backup: 'پشتیبان',
  };
  return map[action] || action;
}

function detailText(a: { action: string; detail?: Record<string, unknown> }): string {
  const d = a.detail || {};
  switch (a.action) {
    case 'count':
    case 'count2':
      return `${d.name || ''} : ${d.prev ?? '—'} ← ${d.next ?? '—'}`;
    case 'undo':
      return `برگشت: ${d.name || d.summary || ''} → ${d.restored ?? '—'}`;
    case 'import':
    case 'import_json':
      return `ورود ${d.count ?? d.added ?? 0} کالا` + (d.mode ? ` (${d.mode})` : '');
    case 'merge':
    case 'team_import':
      return `از «${d.operator || ''}» — تطبیق ${d.matched ?? 0} · تداخل ${d.merged ?? 0} · جدید ${d.added ?? 0}`;
    case 'team_export':
    case 'partial_export':
      return `${d.count ?? 0} شمارش`;
    case 'product_add':
    case 'product_edit':
    case 'product_delete':
      return `${d.name || ''} (${d.code || ''})`;
    case 'photo':
      return String(d.name || '');
    case 'clear_counts':
    case 'bulk_zero':
      return `${d.count ?? 0} مورد`;
    case 'session_join':
      return `جلسه ${d.sessionId || ''}`;
    default:
      try {
        return JSON.stringify(d);
      } catch {
        return '';
      }
  }
}

export function getAuditRows(limit = 200): Array<{
  ts: string;
  action: string;
  label: string;
  detail: string;
  operator: string;
}> {
  const list = [...auditLog].reverse().slice(0, limit);
  return list.map((a) => ({
    ts: a.ts,
    action: a.action,
    label: actionLabel(a.action),
    detail: detailText(a),
    operator: a.operator || '',
  }));
}

export function renderAuditList(containerId = 'auditList', limit = 150): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  const q = (
    (document.getElementById('auditSearch') as HTMLInputElement | null)?.value || ''
  )
    .trim()
    .toLowerCase();

  let rows = getAuditRows(500);
  if (q) {
    rows = rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        r.operator.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q)
    );
  }
  rows = rows.slice(0, limit);

  if (!rows.length) {
    el.innerHTML = '<p class="hint" style="padding:12px">لاگی برای نمایش نیست.</p>';
    return;
  }

  el.innerHTML = rows
    .map(
      (r) => `
    <div class="audit-item">
      <div class="audit-top">
        <span class="audit-action">${esc(r.label)}</span>
        <span class="audit-time">${esc(formatAuditTime(r.ts))}</span>
      </div>
      <div class="audit-detail">${esc(r.detail)}</div>
      ${r.operator ? `<div class="audit-op">👤 ${esc(r.operator)}</div>` : ''}
    </div>`
    )
    .join('');
}

export function exportAuditCSV(): void {
  const rows = getAuditRows(2000).map((r) => ({
    زمان: formatAuditTime(r.ts),
    عملیات: r.label,
    جزئیات: r.detail,
    اپراتور: r.operator,
    کد: r.action,
  }));
  if (!rows.length) {
    toast('لاگی نیست', 'info');
    return;
  }
  downloadFile(rowsToCSV(rows), `anbar-audit-${dateStr()}.csv`, 'text/csv;charset=utf-8');
  toast('لاگ دانلود شد', 'success');
  logAudit('export_audit', { count: rows.length });
}

export function clearAuditLog(): void {
  if (!confirm('تمام لاگ عملیات پاک شود؟ این کار برگشت‌ناپذیر است.')) return;
  auditLog.length = 0;
  saveAuditLog([]);
  save(true);
  toast('لاگ پاک شد', 'success');
  renderAuditList();
}

/** تزریق استایل یک‌بار */
export function ensureAuditStyles(): void {
  if (document.getElementById('audit-styles')) return;
  const st = document.createElement('style');
  st.id = 'audit-styles';
  st.textContent = `
    .audit-item{
      padding:10px 12px;border-bottom:1px solid var(--border-light);
    }
    .audit-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
    .audit-action{font-weight:800;font-size:.88rem;color:var(--primary-dark)}
    .audit-time{font-size:.72rem;color:var(--text-soft);direction:ltr}
    .audit-detail{font-size:.82rem;margin-top:4px;color:var(--text)}
    .audit-op{font-size:.75rem;color:var(--text-soft);margin-top:2px}
    #auditList{max-height:min(50vh,420px);overflow:auto;border:1px solid var(--border-light);border-radius:12px;background:var(--card)}
  `;
  document.head.appendChild(st);
}
