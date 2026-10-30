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
  const mergeMode: MergeMode =
    mode ||
    ((document.getElementById('teamMergeMode') as HTMLSelectElement | null)?.value as MergeMode) ||
    'sum';

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
    } catch {
      // ignore
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
      `ادغام (${mergeMode}): ${matched} بدون تداخل، ${merged} تداخل، ${added} جدید`,
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

// Optional Firebase Realtime Database transport. Local counting and JSON import/export
// continue to work without this configuration or an internet connection.
interface TeamOnlineConfig { url: string; token: string }
interface RemoteDevicePack extends TeamSyncPack { deviceId: string }
const ONLINE_CONFIG_KEY = 'anbar_team_online_config_v1';
const DEVICE_KEY = 'anbar_team_device_id_v1';
const SYNC_MODE_KEY = 'anbar_team_sync_mode_v1';
type TeamSyncMode = 'offline' | 'live' | 'hybrid';
let autoSyncTimer: number | null = null;
const REMOTE_CACHE_PREFIX = 'anbar_team_remote_cache_v1:';
let onlineSyncBusy = false;
let onlineSyncInitialized = false;

function onlineConfig(): TeamOnlineConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(ONLINE_CONFIG_KEY) || '{}');
    return { url: String(parsed.url || '').trim().replace(/\/+$/, ''), token: String(parsed.token || '').trim() };
  } catch { return { url: '', token: '' }; }
}

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = generateId('device');
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* device id remains in memory only */ }
  }
  return id;
}

function firebaseUrl(path: string): string {
  const cfg = onlineConfig();
  const url = `${cfg.url}/${path.split('/').map(encodeURIComponent).join('/')}.json`;
  if (!cfg.token) return url;
  return `${url}?auth=${encodeURIComponent(cfg.token)}`;
}

function setOnlineStatus(message: string, isError = false): void {
  const el = document.getElementById('teamOnlineStatus');
  if (el) {
    el.textContent = message;
    el.style.color = isError ? 'var(--danger, #b42318)' : '';
  }
}

function currentTeamSyncMode(): TeamSyncMode {
  const raw = localStorage.getItem(SYNC_MODE_KEY);
  return raw === 'live' || raw === 'hybrid' ? raw : 'offline';
}

export function saveTeamSyncMode(): void {
  const el = document.getElementById('teamSyncMode') as HTMLSelectElement | null;
  const mode: TeamSyncMode = el?.value === 'live' || el?.value === 'hybrid' ? el.value : 'offline';
  try { localStorage.setItem(SYNC_MODE_KEY, mode); } catch { /* current selection still applies until reload */ }
  configureAutoSync();
  refreshTeamOnlineStatus();
  toast(mode === 'offline' ? 'حالت آفلاین انتخاب شد' : mode === 'live' ? 'همگام‌سازی زنده انتخاب شد' : 'حالت ترکیبی انتخاب شد', 'success');
}

export function saveTeamOnlineConfig(): void {
  const urlEl = document.getElementById('teamOnlineUrl') as HTMLInputElement | null;
  const tokenEl = document.getElementById('teamOnlineToken') as HTMLInputElement | null;
  const url = (urlEl?.value || '').trim().replace(/\/+$/, '');
  const token = (tokenEl?.value || '').trim();
  if (url && !/^https:\/\//i.test(url)) {
    toast('نشانی پایگاه داده باید با https:// شروع شود', 'error');
    return;
  }
  try {
    localStorage.setItem(ONLINE_CONFIG_KEY, JSON.stringify({ url, token }));
    configureAutoSync();
    toast(url ? 'تنظیمات همگام‌سازی آنلاین ذخیره شد' : 'تنظیمات آنلاین پاک شد؛ برای کار آفلاین حالت آفلاین را انتخاب کنید', 'success');
    refreshTeamOnlineStatus();
  } catch {
    toast('ذخیره تنظیمات آنلاین در این دستگاه ممکن نشد', 'error');
  }
}

export function refreshTeamOnlineStatus(): void {
  const cfg = onlineConfig();
  const urlEl = document.getElementById('teamOnlineUrl') as HTMLInputElement | null;
  const tokenEl = document.getElementById('teamOnlineToken') as HTMLInputElement | null;
  if (urlEl && document.activeElement !== urlEl) urlEl.value = cfg.url;
  if (tokenEl && document.activeElement !== tokenEl) tokenEl.value = cfg.token;
  const mode = currentTeamSyncMode();
  const modeText = mode === 'offline' ? 'حالت انتخابی: آفلاین.' : mode === 'live' ? 'حالت انتخابی: آنلاین زنده.' : 'حالت انتخابی: ترکیبی.';
  if (urlEl && document.activeElement !== urlEl) { /* retain saved URL above */ }
  if (mode === 'offline') setOnlineStatus(`${modeText} همگام‌سازی خودکار خاموش است؛ فایل JSON و شمارش محلی فعال‌اند.`);
  else if (!cfg.url) setOnlineStatus(`${modeText} برای همگام‌سازی آنلاین، ابتدا نشانی Firebase را وارد و ذخیره کنید.`, true);
  else if (!navigator.onLine) setOnlineStatus(`${modeText} اینترنت قطع است؛ شمارش محلی حفظ می‌شود و همگام‌سازی خودکار پس از اتصال از سر گرفته می‌شود.`);
  else setOnlineStatus(`${modeText} همگام‌سازی خودکار هر 5 ثانیه بررسی می‌شود؛ می‌توانید دستی هم همگام‌سازی کنید.`);
}

function makeOnlinePack(): RemoteDevicePack {
  ensureSession();
  let previous: Record<string, { q1: number; q2: number }> = {};
  try { previous = JSON.parse(localStorage.getItem(REMOTE_CACHE_PREFIX + (session?.id || '')) || '{}'); } catch { previous = {}; }
  // Publish this device's own contribution only, not the remote counts already merged locally.
  const counted = products.map(p => {
    const old = previous[productKey({ code: p.code, sku: p.sku, name: p.name })] || { q1: 0, q2: 0 };
    const q1 = p.countedQty == null ? null : Number(p.countedQty) - old.q1;
    const q2 = p.countedQty2 == null ? null : Number(p.countedQty2) - old.q2;
    return { p, q1, q2 };
  }).filter(x => x.q1 !== null || x.q2 !== null);
  return {
    type: 'anbar-team-sync', version: 4, sessionId: session?.id || '',
    warehouse: settings.currentWarehouse || '', operator: getOperatorName(), role: settings.role,
    deviceId: deviceId(), exportedAt: new Date().toISOString(), countTotal: counted.length,
    counts: counted.map(({ p, q1, q2 }) => ({ code: p.code || '', sku: p.sku || '', name: p.name,
      countedQty: q1, countedQty2: q2, systemQty: p.systemQty,
      location: p.location || '', warehouse: p.warehouse || settings.currentWarehouse || '',
      note: p.note || '', price: p.price || 0, updatedAt: p.countUpdatedAt || null }))
  };
}

function productKey(c: { code?: string; sku?: string; name?: string }): string {
  if (c.code?.trim()) return 'code:' + c.code.trim().toLowerCase();
  if (c.sku?.trim()) return 'sku:' + c.sku.trim().toLowerCase();
  return 'name:' + (c.name || '').trim().toLowerCase();
}

/** Push this device's contribution and reconcile latest contributions from other devices.
 * The per-device layout prevents repeatedly pulling the same counts from adding them twice. */
export async function syncTeamOnlineNow(quiet = false): Promise<void> {
  if (onlineSyncBusy) return;
  const cfg = onlineConfig();
  if (!cfg.url) {
    setOnlineStatus('ابتدا نشانی Firebase Realtime Database را وارد و ذخیره کنید.', true);
    toast('تنظیمات همگام‌سازی آنلاین کامل نیست', 'error');
    return;
  }
  if (!navigator.onLine) {
    setOnlineStatus('اینترنت در دسترس نیست؛ داده‌ها محلی حفظ شده‌اند.', true);
    toast('اینترنت قطع است؛ حالت آفلاین فعال است', 'info');
    return;
  }
  onlineSyncBusy = true;
  const button = document.getElementById('btnSyncTeamOnline') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  setOnlineStatus('در حال ارسال و دریافت شمارش‌های تیم…');
  try {
    const pack = makeOnlinePack();
    if (!pack.sessionId) throw new Error('شناسه جلسه موجود نیست');
    const root = `teams/${pack.sessionId}`;
    const put = await fetch(firebaseUrl(`${root}/devices/${pack.deviceId}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pack), cache: 'no-store'
    });
    if (!put.ok) throw new Error(`ارسال آنلاین ناموفق بود (HTTP ${put.status})`);
    const get = await fetch(firebaseUrl(`${root}/devices`), { cache: 'no-store' });
    if (!get.ok) throw new Error(`دریافت آنلاین ناموفق بود (HTTP ${get.status})`);
    const remote = await get.json() as Record<string, RemoteDevicePack> | null;
    const all = Object.values(remote || {}).filter(p => p && p.deviceId !== pack.deviceId && Array.isArray(p.counts));
    const totals = new Map<string, { item: TeamCountItem; q1: number; q2: number }>();
    for (const rp of all) for (const c of rp.counts) {
      const key = productKey(c);
      if (key === 'name:') continue;
      const item = totals.get(key) || { item: c, q1: 0, q2: 0 };
      if (c.countedQty !== null && c.countedQty !== undefined) item.q1 += Number(c.countedQty) || 0;
      if (c.countedQty2 !== null && c.countedQty2 !== undefined) item.q2 += Number(c.countedQty2) || 0;
      totals.set(key, item);
    }
    const cacheKey = REMOTE_CACHE_PREFIX + pack.sessionId;
    let previous: Record<string, { q1: number; q2: number }> = {};
    try { previous = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch { previous = {}; }
    const nextCache: Record<string, { q1: number; q2: number }> = {};
    const byKey = new Map<string, number>();
    products.forEach((p, i) => {
      byKey.set(productKey({ code: p.code, sku: p.sku, name: p.name }), i);
    });
    for (const [key, total] of totals) {
      nextCache[key] = { q1: total.q1, q2: total.q2 };
      let idx = byKey.get(key);
      if (idx === undefined) {
        const c = total.item;
        const np: Product = {
          id: generateId('sync'), name: c.name || 'کالای همگام‌شده', code: c.code || '', sku: c.sku || '',
          unit: 'عدد', systemQty: Number(c.systemQty) || 0, price: Number(c.price) || 0,
          location: c.location || '', warehouse: c.warehouse || settings.currentWarehouse || 'انبار اصلی',
          note: c.note || '', countedQty: null, countedQty2: null, createdAt: new Date().toISOString()
        };
        products.push(np); idx = products.length - 1; byKey.set(key, idx);
      }
      const p = products[idx];
      const old = previous[key] || { q1: 0, q2: 0 };
      const local1 = p.countedQty == null ? 0 : Number(p.countedQty) - old.q1;
      const local2 = p.countedQty2 == null ? 0 : Number(p.countedQty2) - old.q2;
      p.countedQty = (p.countedQty == null && total.q1 === 0 && old.q1 === 0) ? null : local1 + total.q1;
      p.countedQty2 = (p.countedQty2 == null && total.q2 === 0 && old.q2 === 0) ? null : local2 + total.q2;
      p.countUpdatedAt = new Date().toISOString();
    }
    // Remove remote contribution from products that disappeared from the server.
    for (const [key, old] of Object.entries(previous)) {
      if (totals.has(key)) continue;
      const idx = byKey.get(key);
      if (idx === undefined) continue;
      const p = products[idx];
      if (p.countedQty != null) p.countedQty = Math.max(0, Number(p.countedQty) - old.q1);
      if (p.countedQty2 != null) p.countedQty2 = Math.max(0, Number(p.countedQty2) - old.q2);
    }
    try { localStorage.setItem(cacheKey, JSON.stringify(nextCache)); } catch { /* sync still succeeds for this run */ }
    rebuildIndex(); save(true); invalidateStats();
    logAudit('team_online_sync', { sessionId: pack.sessionId, remoteDevices: all.length, remoteProducts: totals.size });
    setOnlineStatus(`همگام‌سازی موفق · دستگاه‌های دیگر: ${all.length} · کالاهای دریافتی: ${totals.size} · ${new Date().toLocaleTimeString()}`);
    if (!quiet) toast('همگام‌سازی آنلاین انجام شد', 'success');
  } catch (err) {
    console.error('[Anbarin] team online sync failed:', err);
    const message = err instanceof Error ? err.message : 'خطای ناشناخته';
    setOnlineStatus(`همگام‌سازی انجام نشد: ${message} · داده‌های محلی حفظ شده‌اند.`, true);
    if (!quiet) toast('همگام‌سازی آنلاین ناموفق بود؛ اطلاعات محلی حذف نشده‌اند', 'error');
  } finally {
    onlineSyncBusy = false;
    if (button) button.disabled = false;
  }
}

function configureAutoSync(): void {
  if (autoSyncTimer !== null) {
    window.clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  const mode = currentTeamSyncMode();
  if (mode === 'offline') return;
  autoSyncTimer = window.setInterval(() => {
    if (document.visibilityState === 'hidden' || !navigator.onLine || !onlineConfig().url || onlineSyncBusy) return;
    void syncTeamOnlineNow(true);
  }, 5000);
}

export function initializeTeamOnlineSync(): void {
  const modeEl = document.getElementById('teamSyncMode') as HTMLSelectElement | null;
  if (modeEl) modeEl.value = currentTeamSyncMode();
  if (!onlineSyncInitialized) {
    onlineSyncInitialized = true;
    window.addEventListener('online', () => {
      refreshTeamOnlineStatus();
      // Auto-sync resumes only when a live/hybrid mode is selected.
      configureAutoSync();
    });
    window.addEventListener('offline', () => refreshTeamOnlineStatus());
  }
  configureAutoSync();
  refreshTeamOnlineStatus();
}
