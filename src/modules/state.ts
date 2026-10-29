/**
 * State مرکزی برنامه — single source of truth
 */

import type {
  Product,
  AppSettings,
  Session,
  AuditEntry,
  UndoItem,
  CountStats,
  StorageBackend,
  RecentScan,
} from '@/types';
import {
  loadAppState,
  persistAppState,
  loadSettings,
  saveSettings,
  loadSession,
  saveSession,
  loadAuditLog,
  saveAuditLog,
  loadRecentScans,
  saveRecentScans,
  getOperatorName,
  DEFAULT_SETTINGS,
} from './storage';
import { generateId } from '@/utils/helpers';

// ——— State ———
export let products: Product[] = [];
export let settings: AppSettings = { ...DEFAULT_SETTINGS };
export let session: Session | null = null;
export let auditLog: AuditEntry[] = [];
export let recentScans: RecentScan[] = [];
export let undoStack: UndoItem[] = [];
export let storageBackend: StorageBackend = 'pending';

const UNDO_MAX = 50;
const AUDIT_MAX = 500;

// Index برای جستجوی سریع بارکد
let codeIndex: Record<string, number> = {};
let statsCache: CountStats | null = null;

// ——— Index ———
export function rebuildIndex(): void {
  codeIndex = {};
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (p.code) {
      const c = String(p.code).trim();
      codeIndex[c] = i;
      codeIndex[c.toLowerCase()] = i;
    }
    if (p.sku) {
      const s = String(p.sku).trim();
      codeIndex[s] = i;
      codeIndex[s.toLowerCase()] = i;
    }
  }
  statsCache = null;
}

export function findProductByCode(code: string | null | undefined): Product | null {
  if (!code) return null;
  const t = String(code).trim();
  let i = codeIndex[t];
  if (i === undefined) i = codeIndex[t.toLowerCase()];
  if (i === undefined) return null;
  return products[i] || null;
}

export function invalidateStats(): void {
  statsCache = null;
}

export function getCountStats(): CountStats {
  if (statsCache) return statsCache;

  let counted = 0;
  let counted2 = 0;
  let diffs = 0;
  let withPhoto = 0;
  const phase2 = isDoubleCount() && countPhase() === 2;

  for (const p of products) {
    if (p.countedQty !== null && p.countedQty !== undefined) counted++;
    if (p.countedQty2 != null && p.countedQty2 !== undefined) counted2++;
    if (p.countedQty !== null && p.countedQty !== p.systemQty) diffs++;
    if (p.photo) withPhoto++;
  }

  statsCache = { total: products.length, counted, counted2, diffs, withPhoto, phase2 };
  return statsCache;
}

// ——— Double count helpers ———
export function isDoubleCount(): boolean {
  return !!settings.doubleCount;
}

export function countPhase(): 1 | 2 {
  // می‌تواند از settings یا session گرفته شود؛ فعلاً ساده
  return settings.countPhase === 2 ? 2 : 1;
}

export function setCountPhase(phase: 1 | 2): void {
  settings.countPhase = phase;
  saveSettings(settings);
  invalidateStats();
}

// ——— Warehouse filter ———
export function filterByActiveWarehouse(list: Product[]): Product[] {
  const wh = settings.currentWarehouse;
  if (!wh || wh === 'همه') return list;
  return list.filter((p) => (p.warehouse || 'انبار اصلی') === wh);
}

// ——— Undo ———
export function pushUndo(item: UndoItem): void {
  undoStack.push(item);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

export function popUndo(): UndoItem | undefined {
  return undoStack.pop();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

// ——— Audit ———
export function logAudit(action: string, detail: Record<string, unknown> = {}): void {
  auditLog.push({
    id: generateId('a'),
    action,
    ts: new Date().toISOString(),
    detail,
    operator: getOperatorName(),
  });
  if (auditLog.length > AUDIT_MAX) {
    auditLog = auditLog.slice(-AUDIT_MAX);
  }
  saveAuditLog(auditLog, AUDIT_MAX);
}

// ——— Persist ———
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function save(immediate = false): void {
  const doSave = async () => {
    storageBackend = await persistAppState({
      products,
      settings,
      session,
      auditLog,
      recentScans,
    });
  };

  if (immediate) {
    doSave();
    return;
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 400);
}

export function saveSettingsNow(): void {
  saveSettings(settings);
  save(true);
}

// ——— Boot ———
export async function bootState(): Promise<string> {
  const { state, source } = await loadAppState();

  products = state.products || [];
  settings = { ...DEFAULT_SETTINGS, ...(state.settings || loadSettings()) };
  session = state.session ?? loadSession();
  auditLog = state.auditLog || loadAuditLog();
  recentScans = state.recentScans || loadRecentScans();

  rebuildIndex();
  storageBackend = source.startsWith('idb') ? 'idb' : source;

  return source;
}

// ——— Session helpers ———
export function startNewSession(silent = false): boolean {
  if (!silent && products.some((p) => p.countedQty !== null)) {
    if (!confirm('شمارش‌های فعلی پاک شود و جلسه جدید شروع شود؟')) return false;
    products.forEach((p) => {
      p.countedQty = null;
      p.countedQty2 = null;
    });
  }

  session = {
    id: generateId('s'),
    startedAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
  };
  saveSession(session);
  recentScans = [];
  saveRecentScans(recentScans);
  undoStack = [];
  invalidateStats();
  save(true);

  if (!silent) {
    logAudit('session', {});
  }
  return true;
}

export function closeSession(): void {
  if (!session) return;
  session.closedAt = new Date().toISOString();
  session.closedBy = getOperatorName();
  saveSession(session);
  save(true);
  logAudit('close_session', { sessionId: session.id });
}
