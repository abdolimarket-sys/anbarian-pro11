/**
 * لایه ذخیره‌سازی — IndexedDB (اصلی) + localStorage (پشتیبان/متا)
 */

import type { AppState, Product, AppSettings, Session, AuditEntry, StorageBackend, RecentScan } from '@/types';

const DB_NAME = 'anbarin_db';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ——— تنظیمات و وضعیت برنامه ———

const DEFAULT_SETTINGS: AppSettings = {
  continuousScan: true,
  autoNextScan: true,
  soundOnScan: true,
  vibrateOnScan: true,
  autoIncrement: true,
  blindCount: false,
  btScanner: true,
  doubleCount: false,
  role: 'admin',
  warehouses: ['انبار اصلی'],
  currentWarehouse: 'انبار اصلی',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('anbar_settings');
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem('anbar_settings', JSON.stringify(settings));
}

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem('anbar_session') || 'null');
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  if (session) localStorage.setItem('anbar_session', JSON.stringify(session));
  else localStorage.removeItem('anbar_session');
}

export function loadAuditLog(): AuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem('anbar_audit') || '[]');
  } catch {
    return [];
  }
}

export function saveAuditLog(log: AuditEntry[], max = 500): void {
  try {
    localStorage.setItem('anbar_audit', JSON.stringify(log.slice(-max)));
  } catch {
    // ignore quota
  }
}

export function loadRecentScans(): RecentScan[] {
  try {
    const raw = JSON.parse(localStorage.getItem('anbar_recent') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveRecentScans(scans: RecentScan[]): void {
  try {
    localStorage.setItem('anbar_recent', JSON.stringify(scans.slice(0, 50)));
  } catch {
    // ignore
  }
}

export function getOperatorName(): string {
  return (localStorage.getItem('anbar_operator') || '').trim() || 'ناشناس';
}

export function setOperatorName(name: string): void {
  localStorage.setItem('anbar_operator', name.trim());
}

/** ذخیره کامل وضعیت برنامه */
export async function persistAppState(
  state: AppState
): Promise<StorageBackend> {
  const full = {
    ...state,
    savedAt: new Date().toISOString(),
    version: 2,
  };

  try {
    await idbPut('app_state', full);
    // backup ثانویه
    idbPut('autobackup', full).catch(() => {});
    try {
      localStorage.setItem(
        'anbar_products_meta',
        JSON.stringify({
          count: state.products.length,
          at: new Date().toISOString(),
          note: 'full data in IndexedDB',
        })
      );
    } catch {
      // ignore
    }
    return 'idb';
  } catch (err) {
    console.error('idb persist fail', err);
    // fallback به localStorage (فقط برای دیتای کوچک)
    try {
      localStorage.setItem('anbar_products', JSON.stringify(state.products));
      return 'local+idb';
    } catch {
      return 'pending';
    }
  }
}

/** بارگذاری وضعیت برنامه با اولویت IndexedDB */
export async function loadAppState(): Promise<{
  state: Partial<AppState>;
  source: string;
}> {
  // ۱) IndexedDB اصلی
  try {
    const state = await idbGet<any>('app_state');
    if (state && Array.isArray(state.products)) {
      return {
        state: {
          products: state.products,
          settings: state.settings,
          session: state.session,
          auditLog: state.auditLog,
          recentScans: state.recentScans,
        },
        source: 'idb',
      };
    }
  } catch (e) {
    console.warn('idb load failed', e);
  }

  // ۲) مهاجرت از localStorage قدیمی
  try {
    const raw = localStorage.getItem('anbar_products');
    if (raw) {
      const products: Product[] = JSON.parse(raw);
      if (Array.isArray(products) && products.length) {
        // مهاجرت فوری
        const snapshot = {
          products,
          settings: loadSettings(),
          session: loadSession(),
          auditLog: loadAuditLog(),
          recentScans: loadRecentScans(),
        };
        idbPut('app_state', snapshot).catch(() => {});
        return { state: snapshot, source: 'localStorage-migrated' };
      }
    }
  } catch {
    // ignore
  }

  // ۳) autobackup
  try {
    const ab = await idbGet<any>('autobackup');
    if (ab && Array.isArray(ab.products)) {
      return {
        state: {
          products: ab.products,
          settings: ab.settings,
          session: ab.session,
          auditLog: ab.auditLog,
          recentScans: ab.recentScans,
        },
        source: 'idb-autobackup',
      };
    }
  } catch {
    // ignore
  }

  return {
    state: {
      products: [],
      settings: loadSettings(),
      session: loadSession(),
      auditLog: loadAuditLog(),
      recentScans: loadRecentScans(),
    },
    source: 'empty',
  };
}

export { DEFAULT_SETTINGS };
