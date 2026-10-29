/** مدل داده اصلی کالا */
export interface Product {
  id: string;
  name: string;
  code?: string;
  sku?: string;
  unit?: string;
  unitFactor?: number;
  systemQty: number;
  countedQty: number | null;
  countedQty2?: number | null;
  price?: number;
  location?: string;
  warehouse?: string;
  serial?: string;
  batch?: string;
  expiry?: string;
  note?: string;
  photo?: string;
  photoAt?: string;
  minQty?: number | null;
  maxQty?: number | null;
  createdAt?: string;
  countUpdatedAt?: string;
}

export interface AppSettings {
  continuousScan: boolean;
  autoNextScan: boolean;
  soundOnScan: boolean;
  vibrateOnScan: boolean;
  autoIncrement: boolean;
  blindCount: boolean;
  btScanner: boolean;
  doubleCount: boolean;
  role: 'admin' | 'viewer' | 'counter';
  warehouses: string[];
  currentWarehouse: string;
  theme?: 'light' | 'dark';
  countPhase?: 1 | 2;
  quickAutoConfirm?: boolean;
}

export interface Session {
  id: string;
  startedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  joinedAt?: string;
}

export interface AuditEntry {
  id?: string;
  action: string;
  ts: string;
  detail?: Record<string, unknown>;
  operator?: string;
}

export interface UndoItem {
  type: 'count' | 'count2' | 'bulk';
  id?: string;
  prev: number | null;
  next?: number | null;
  name?: string;
  ts: number;
  items?: Array<{ id: string; prev: number | null }>;
  phase?: number;
}

export interface CountStats {
  total: number;
  counted: number;
  counted2: number;
  diffs: number;
  withPhoto: number;
  phase2: boolean;
}

export interface LicenseInfo {
  org: string;
  exp: string;
  plan: string;
  device?: string | null;
  demo?: boolean;
  activatedAt?: string;
}

export interface RecentScan {
  id: string;
  name: string;
  qty: number | null;
}

export interface AppState {
  products: Product[];
  settings: AppSettings;
  session: Session | null;
  auditLog: AuditEntry[];
  recentScans: RecentScan[];
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type StorageBackend =
  | 'idb'
  | 'local+idb'
  | 'localStorage'
  | 'pending'
  | 'idb-autobackup'
  | string;
