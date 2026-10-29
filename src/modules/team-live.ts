/** همگام‌سازی زنده اختیاری با Supabase REST (بدون وابستگی اضافی). */
import { products, session, settings, save, rebuildIndex, invalidateStats, logAudit } from './state';
import { toast } from './ui';
import { getOperatorName } from './storage';

type LiveConfig = { url: string; key: string };
type RemoteCount = { session_id: string; product_key: string; device_id: string; code: string; sku: string; name: string; counted_qty: number | null; counted_qty2: number | null; updated_at: string; operator_name: string; warehouse: string };
const CFG_KEY = 'anbarin_live_sync_config_v1';
const MODE_KEY = 'anbarin_team_sync_mode_v1';
const DEVICE_KEY = 'anbarin_live_device_id_v1';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let applyingRemote = false;
let lastStatus = '';

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = `dev_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`; localStorage.setItem(DEVICE_KEY, id); }
  return id;
}
export function getTeamSyncMode(): 'offline' | 'live' { return localStorage.getItem(MODE_KEY) === 'live' ? 'live' : 'offline'; }
export function setTeamSyncMode(mode: 'offline' | 'live'): void { localStorage.setItem(MODE_KEY, mode); if (mode === 'offline') stopLiveSync(); }
export function isApplyingRemote(): boolean { return applyingRemote; }
function getConfig(): LiveConfig | null {
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null') as LiveConfig | null; if (!c?.url || !c?.key) return null; return { url: c.url.replace(/\/$/, ''), key: c.key }; } catch { return null; }
}
export function saveLiveConfig(url: string, key: string): boolean {
  const cleanUrl = url.trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(cleanUrl) || !key.trim()) { toast('آدرس HTTPS پروژه و کلید عمومی را درست وارد کنید', 'error'); return false; }
  localStorage.setItem(CFG_KEY, JSON.stringify({ url: cleanUrl, key: key.trim() }));
  toast('تنظیمات اتصال ذخیره شد', 'success'); return true;
}
function sessionId(): string { return session?.id || (document.getElementById('teamSessionCode') as HTMLInputElement | null)?.value || ''; }
function productKey(p: { code?: string; sku?: string; name?: string }): string {
  const c = String(p.code || '').trim().toLowerCase(); if (c) return `b:${c}`;
  const s = String(p.sku || '').trim().toLowerCase(); if (s) return `s:${s}`;
  return `n:${String(p.name || '').trim().toLowerCase()}`;
}
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const c = getConfig(); if (!c) throw new Error('تنظیمات Supabase وارد نشده است');
  const headers = new Headers(init.headers || {});
  headers.set('apikey', c.key);
  headers.set('Authorization', `Bearer ${c.key}`);
  headers.set('Content-Type', 'application/json');
  if (!headers.has('Prefer')) headers.set('Prefer', 'resolution=merge-duplicates,return=minimal');
  return fetch(`${c.url}/rest/v1/${path}`, { ...init, headers });
}
async function pushLocal(): Promise<void> {
  const sid = sessionId(); if (!sid) return;
  const rows: RemoteCount[] = products.filter(p => p.countedQty !== null || p.countedQty2 != null).map(p => ({ session_id: sid, product_key: productKey(p), device_id: deviceId(), code: p.code || '', sku: p.sku || '', name: p.name || '', counted_qty: p.countedQty ?? null, counted_qty2: p.countedQty2 ?? null, updated_at: p.countUpdatedAt || '1970-01-01T00:00:00.000Z', operator_name: getOperatorName(), warehouse: p.warehouse || settings.currentWarehouse || '' }));
  if (!rows.length) return;
  const res = await request('anbar_live_counts?on_conflict=session_id,product_key,device_id', { method: 'POST', body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`ارسال ناموفق (${res.status})`);
}
async function pullRemote(): Promise<void> {
  const sid = sessionId(); if (!sid) return;
  const res = await request(`anbar_live_counts?session_id=eq.${encodeURIComponent(sid)}&select=*&order=updated_at.asc`);
  if (!res.ok) throw new Error(`دریافت ناموفق (${res.status})`);
  const rows = await res.json() as RemoteCount[];
  let changed = false;
  applyingRemote = true;
  try {
    for (const row of rows) {
      if (row.device_id === deviceId()) continue;
      let p = row.code ? products.find(x => String(x.code || '').trim().toLowerCase() === row.code.trim().toLowerCase()) : undefined;
      if (!p && row.sku) p = products.find(x => String(x.sku || '').trim().toLowerCase() === row.sku.trim().toLowerCase());
      if (!p && row.name) p = products.find(x => String(x.name || '').trim().toLowerCase() === row.name.trim().toLowerCase());
      if (!p) continue;
      const remoteTs = Date.parse(row.updated_at || '') || 0;
      const localTs = Date.parse(p.countUpdatedAt || '') || 0;
      if (remoteTs <= localTs) continue;
      p.countedQty = row.counted_qty;
      p.countedQty2 = row.counted_qty2;
      p.countUpdatedAt = row.updated_at;
      changed = true;
    }
  } finally { applyingRemote = false; }
  if (changed) { rebuildIndex(); invalidateStats(); save(); window.dispatchEvent(new CustomEvent('anbar-live-counts-updated')); }
}
async function tick(): Promise<void> {
  if (!running || getTeamSyncMode() !== 'live' || !navigator.onLine) { setStatus(navigator.onLine ? 'حالت آفلاین انتخاب شده' : 'اینترنت قطع است؛ شمارش محلی ادامه دارد'); return; }
  try { await pushLocal(); await pullRemote(); setStatus('متصل · همگام‌سازی زنده فعال است'); }
  catch (e) { setStatus(`اتصال برقرار نشد: ${e instanceof Error ? e.message : 'خطای ناشناخته'}`); }
}
function setStatus(s: string): void { if (s === lastStatus) return; lastStatus = s; const el = document.getElementById('teamLiveStatus'); if (el) el.textContent = s; }
export async function startLiveSync(): Promise<boolean> {
  const c = getConfig(); if (!c) { toast('ابتدا آدرس پروژه و کلید عمومی Supabase را وارد کنید', 'error'); return false; }
  stopLiveSync(); running = true;
  try {
    const test = await request('anbar_live_counts?select=session_id&limit=1');
    if (!test.ok) throw new Error(`خطای دسترسی ${test.status}؛ جدول و دسترسی‌ها را بررسی کنید`);
    await tick(); pollTimer = setInterval(() => { void tick(); }, 3500);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    toast('همگام‌سازی زنده شروع شد', 'success'); return true;
  } catch (e) { running = false; setStatus(e instanceof Error ? e.message : 'اتصال ناموفق'); toast('اتصال زنده برقرار نشد؛ تنظیمات و SQL را بررسی کنید', 'error'); return false; }
}
function onOnline(): void { void tick(); }
function onOffline(): void { setStatus('اینترنت قطع است؛ شمارش محلی ادامه دارد'); }
export function stopLiveSync(): void { running = false; if (pollTimer) clearInterval(pollTimer); pollTimer = null; window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); setStatus('همگام‌سازی زنده متوقف است'); }
export function notifyTeamLiveChange(): void { if (getTeamSyncMode() === 'live' && running && !applyingRemote) void tick(); }
export function fillLiveConfigForm(): void { const c = getConfig(); const url = document.getElementById('teamSupabaseUrl') as HTMLInputElement | null; const key = document.getElementById('teamSupabaseKey') as HTMLInputElement | null; const mode = document.getElementById('teamSyncMode') as HTMLSelectElement | null; if (url) url.value = c?.url || ''; if (key) key.value = c?.key || ''; if (mode) mode.value = getTeamSyncMode(); }
