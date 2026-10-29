/**
 * همگام‌سازی تیمی از طریق فایل JSON
 * - صدور بسته شمارش این دستگاه
 * - دریافت و ادغام با حالت‌های sum / max / incoming / local
 * - کد جلسه مشترک
 */

import type { Product } from '@/types';
import {
  products,
  settings,
  session,
  logAudit,
  save,
  rebuildIndex,
  invalidateStats,
  startNewSession,
} from './state';
import { toast } from './ui';
import { downloadFile, dateStr, generateId } from '@/utils/helpers';
import { getOperatorName, saveSession } from './storage';
import { canCount } from './count';

export type MergeMode = 'sum' | 'max' | 'incoming' | 'local';

export interface TeamCountItem {
  code: string;
  sku: string;
  name: string;
  countedQty: number | null;
  countedQty2?: number | null;
  systemQty: number;
  location?: string;
  warehouse?: string;
  note?: string;
  price?: number;
  updatedAt?: string | null;
}

export interface TeamSyncPack {
  type: 'anbar-team-sync' | 'anbar-partial';
  version: number;
  sessionId: string;
  warehouse: string;
  operator: string;
  role?: string;
  deviceId?: string;
  /** شناسه یکتای بسته برای جلوگیری از ادغام تکراری */
  packId?: string;
  exportedAt: string;
  countTotal: number;
  counts: TeamCountItem[];
}

export interface MergeReport {
  at: string;
  mode: MergeMode;
  operator: string;
  sessionId: string;
  matched: number;
  added: number;
  merged: number;
  skipped: number;
}

let lastMergeReport: MergeReport | null = null;

function ensureSession(): void {
  if (!session) {
    startNewSession(true);
  }
}

export function getTeamSessionCode(): string {
  ensureSession();
  return session?.id || '';
}

export function copyTeamSessionCode(): void {
  const code = getTeamSessionCode();
  const el = document.getElementById('teamSessionCode') as HTMLInputElement | null;
  if (el) el.value = code;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(
      () => toast('کد جلسه کپی شد', 'success'),
      () => prompt('کد جلسه:', code)
    );
  } else {
    prompt('کد جلسه:', code);
  }
}

export function joinTeamSession(codeRaw?: string): boolean {
  const inp = document.getElementById('joinSessionInput') as HTMLInputElement | null;
  const code = (codeRaw ?? inp?.value ?? '').trim();
  if (!code) {
    toast('کد جلسه را وارد کنید', 'error');
    return false;
  }

  if (
    products.some((p) => p.countedQty !== null) &&
    !confirm('با پیوستن به جلسه دیگر، شمارش‌های فعلی روی همین دستگاه می‌ماند ولی کد جلسه عوض می‌شود. ادامه؟')
  ) {
    return false;
  }

  ensureSession();
  if (session) {
    session.id = code;
    session.joinedAt = new Date().toISOString();
    saveSession(session);
  }
  logAudit('session_join', { sessionId: code });
  toast('به جلسه ' + code + ' پیوستید', 'success');
  return true;
}

export function exportTeamSyncPack(): void {
  if (!canCount() && settings.role !== 'admin') {
    toast('دسترسی ندارید', 'error');
    return;
  }
  ensureSession();
  const op = getOperatorName();
  const counted = products.filter(
    (p) => p.countedQty !== null || (p.countedQty2 != null && p.countedQty2 !== undefined)
  );
  if (!counted.length) {
    toast('شمارشی برای ارسال نیست', 'error');
    return;
  }

  const payload: TeamSyncPack = {
    type: 'anbar-team-sync',
    version: 3,
    sessionId: session?.id || '',
    warehouse: settings.currentWarehouse || '',
    operator: op,
    role: settings.role,
    packId: generateId('pack'),
    exportedAt: new Date().toISOString(),
    countTotal: counted.length,
    counts: counted.map((p) => ({
      code: p.code || '',
      sku: p.sku || '',
      name: p.name,
      countedQty: p.countedQty,
      countedQty2: p.countedQty2,
      systemQty: p.systemQty,
      location: p.location || '',
      warehouse: p.warehouse || settings.currentWarehouse || '',
      note: p.note || '',
      price: p.price || 0,
      updatedAt: p.countUpdatedAt || null,
    })),
  };

  const fname = `team-sync-${session?.id || 'nosession'}-${op}-${dateStr()}.json`;
  downloadFile(JSON.stringify(payload, null, 2), fname, 'application/json');
  logAudit('team_export', {
    count: counted.length,
    sessionId: session?.id,
    warehouse: settings.currentWarehouse,
  });
  toast(`${counted.length} شمارش صادر شد`, 'success');
}

/** خروجی سبک فقط برای ادغام شمارش (سازگار با partial قدیمی) */
export function exportPartialCount(): void {
  ensureSession();
  const op = getOperatorName();
  const counted = products.filter((p) => p.countedQty !== null);
  if (!counted.length) {
    toast('شمارشی نیست', 'error');
    return;
  }
  const payload = {
    type: 'anbar-partial' as const,
    version: 2,
    sessionId: session?.id || '',
    operator: op,
    exportedAt: new Date().toISOString(),
    counts: counted.map((p) => ({
      code: p.code || '',
      sku: p.sku || '',
      name: p.name,
      countedQty: p.countedQty,
      countedQty2: p.countedQty2,
      systemQty: p.systemQty,
      location: p.location || '',
      warehouse: p.warehouse || '',
    })),
  };
  downloadFile(
    JSON.stringify(payload, null, 2),
    `anbar-partial-${op}-${dateStr()}.json`,
    'application/json'
  );
  logAudit('partial_export', { count: counted.length });
  toast('فایل شمارش جزئی ذخیره شد', 'success');
}

function pickValue(
  localV: number | null | undefined,
  incV: number | null | undefined,
  mode: MergeMode
): number | null {
  if (incV === null || incV === undefined) return localV ?? null;
  if (localV === null || localV === undefined) return incV;
  if (localV === incV) return localV;
  if (mode === 'incoming') return incV;
  if (mode === 'local') return localV;
  if (mode === 'max') return Math.max(Number(localV) || 0, Number(incV) || 0);
  // sum
  return (Number(localV) || 0) + (Number(incV) || 0);
}

export async function importTeamSyncPack(
  file: File,
  mode?: MergeMode
): Promise<MergeReport | null> {
  const requestedMode = mode || (document.getElementById('teamMergeMode') as HTMLSelectElement | null)?.value;
  const mergeMode: MergeMode = requestedMode === 'sum' || requestedMode === 'max' || requestedMode === 'incoming' || requestedMode === 'local'
    ? requestedMode
    : 'max';

  try {
    const data = JSON.parse(await file.text()) as TeamSyncPack;
    if (
      !data ||
      (data.type !== 'anbar-team-sync' && data.type !== 'anbar-partial') ||
      !Array.isArray(data.counts)
    ) {
      toast('فایل همگام‌سازی معتبر نیست', 'error');
      return null;
    }

    // جلوگیری از ادغام دوباره یک فایل؛ در حالت sum این کار از دوباره‌شماری جلوگیری می‌کند.
    const packKey = data.packId || [data.type, data.sessionId || '', data.operator || '', data.exportedAt || '', data.counts.length].join('|');
    let importedPacks: string[] = [];
    try { importedPacks = JSON.parse(localStorage.getItem('anbar_imported_team_packs') || '[]'); } catch { importedPacks = []; }
    if (importedPacks.includes(packKey)) {
      toast('این بسته قبلاً وارد شده است؛ برای جلوگیری از دوباره‌شماری، ادغام تکرار نشد', 'info');
      return null;
    }

    if (
      session?.id &&
      data.sessionId &&
      data.sessionId !== session.id &&
      !confirm(
        `کد جلسه فایل (${data.sessionId}) با جلسه فعلی (${session.id}) فرق دارد. باز هم ادغام شود؟`
      )
    ) {
      return null;
    }

    const byCode: Record<string, number> = {};
    const bySku: Record<string, number> = {};
    const byName: Record<string, number> = {};
    products.forEach((p, i) => {
      if (p.code) byCode[String(p.code).trim().toLowerCase()] = i;
      if (p.sku) bySku[String(p.sku).trim().toLowerCase()] = i;
      if (p.name) byName[p.name.trim()] = i;
    });

    let matched = 0;
    let added = 0;
    let merged = 0;
    let skipped = 0;

    data.counts.forEach((c) => {
      if (!c || typeof c !== 'object' || (!String(c.code || '').trim() && !String(c.sku || '').trim() && !String(c.name || '').trim())) {
        skipped++;
        return;
      }
      const validQty = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
      if (!validQty(c.countedQty) || !validQty(c.countedQty2) || (c.systemQty !== undefined && (typeof c.systemQty !== 'number' || !Number.isFinite(c.systemQty) || c.systemQty < 0))) {
        skipped++;
        return;
      }
      let idx: number | undefined;
      const code = String(c.code || '')
        .trim()
        .toLowerCase();
      const sku = String(c.sku || '')
        .trim()
        .toLowerCase();
      if (code && byCode[code] !== undefined) idx = byCode[code];
      else if (sku && bySku[sku] !== undefined) idx = bySku[sku];
      else if (c.name && byName[c.name.trim()] !== undefined) idx = byName[c.name.trim()];

      if (idx === undefined) {
        const np: Product = {
          id: generateId('t'),
          name: c.name || 'کالای ' + (c.code || ''),
          code: c.code || '',
          sku: c.sku || '',
          unit: 'عدد',
          systemQty: c.systemQty || 0,
          price: c.price || 0,
          location: c.location || '',
          warehouse: c.warehouse || settings.currentWarehouse || 'انبار اصلی',
          note: ((c.note || '') + ' [تیم:' + (data.operator || '') + ']').trim(),
          countedQty: c.countedQty,
          countedQty2: c.countedQty2,
          createdAt: new Date().toISOString(),
        };
        products.push(np);
        const ni = products.length - 1;
        if (code) byCode[code] = ni;
        if (sku) bySku[sku] = ni;
        if (c.name) byName[c.name.trim()] = ni;
        added++;
        return;
      }

      const p = products[idx];
      const prev1 = p.countedQty;
      const prev2 = p.countedQty2;
      const next1 = pickValue(p.countedQty, c.countedQty, mergeMode);
      const next2 = pickValue(p.countedQty2, c.countedQty2, mergeMode);

      if (prev1 === next1 && prev2 === next2) {
        matched++;
        return;
      }

      p.countedQty = next1;
      if (next2 !== undefined) p.countedQty2 = next2;
      if (c.location && !p.location) p.location = c.location;
      p.countUpdatedAt = new Date().toISOString();
      merged++;
    });

    rebuildIndex();
    save(true);
    invalidateStats();

    const report: MergeReport = {
      at: new Date().toISOString(),
      mode: mergeMode,
      operator: data.operator || '',
      sessionId: data.sessionId || '',
      matched,
      added,
      merged,
      skipped,
    };
    lastMergeReport = report;
    try {
      localStorage.setItem('anbar_last_team_merge', JSON.stringify(report));
      importedPacks.push(packKey);
      // نگهداری آخرین 500 بسته برای محدود کردن فضای ذخیره‌سازی
      localStorage.setItem('anbar_imported_team_packs', JSON.stringify(importedPacks.slice(-500)));
    } catch {
      // ignore storage quota/private-mode failures
    }

    logAudit('team_import', {
      operator: data.operator,
      matched,
      added,
      merged,
      mode: mergeMode,
      sessionId: data.sessionId,
    });
    toast(
      `ادغام (${mergeMode}): ${matched} بدون تغییر، ${merged} ادغام‌شده، ${added} جدید، ${skipped} نامعتبر/ردشده`,
      'success'
    );
    return report;
  } catch (err) {
    console.error(err);
    toast('خطا در خواندن فایل همگام‌سازی', 'error');
    return null;
  }
}

export function getLastMergeReport(): MergeReport | null {
  if (lastMergeReport) return lastMergeReport;
  try {
    return JSON.parse(localStorage.getItem('anbar_last_team_merge') || 'null');
  } catch {
    return null;
  }
}

export function exportTeamConflictReport(): void {
  const rep = getLastMergeReport();
  if (!rep) {
    toast('گزارش ادغامی نیست', 'info');
    return;
  }
  downloadFile(
    JSON.stringify(rep, null, 2),
    `team-merge-report-${dateStr()}.json`,
    'application/json'
  );
  toast('گزارش ادغام دانلود شد', 'success');
}

export function refreshTeamSyncUI(): void {
  const info = document.getElementById('teamSyncInfo');
  const codeEl = document.getElementById('teamSessionCode') as HTMLInputElement | null;
  const sid = session?.id || '—';
  if (codeEl) codeEl.value = sid === '—' ? '' : sid;
  if (info) {
    info.textContent =
      'کد جلسه: ' +
      sid +
      ' · اپراتور: ' +
      getOperatorName() +
      ' · انبار: ' +
      (settings.currentWarehouse || '—');
  }
}
