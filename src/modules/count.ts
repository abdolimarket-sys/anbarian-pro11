/**
 * ماژول شمارش
 * - ثبت / ویرایش countedQty و countedQty2
 * - Undo
 * - Double-count (فاز ۱ و ۲)
 * - مودال تأیید تعداد
 * - اتصال به نتیجه اسکنر
 */

import type { Product, UndoItem } from '@/types';
import {
  products,
  settings,
  session,
  recentScans,
  undoStack,
  pushUndo,
  popUndo,
  canUndo,
  logAudit,
  save,
  invalidateStats,
  isDoubleCount,
  countPhase,
  findProductByCode,
} from './state';
import { toast } from './ui';
import { playBeep, vibrateOnFail, markConfirmed } from './scanner';
import { formatFaNumber } from '@/utils/helpers';
import { saveRecentScans } from './storage';

// ——— وضعیت مودال تعداد ———
let qtyModalProduct: Product | null = null;
let qtyModalOpen = false;
let lastScannedId: string | null = null;
let lastConfirmedProductId: string | null = null;
let lastConfirmedAt = 0;
const SAME_PRODUCT_SCAN_GUARD_MS = 2500;

/** callback اختیاری برای رفرش UI بعد از تغییر شمارش */
let onCountChanged: (() => void) | null = null;

export function setCountChangeListener(fn: (() => void) | null): void {
  onCountChanged = fn;
}

function notifyChange(): void {
  invalidateStats();
  onCountChanged?.();
}

// ——— Guards ———

export function canCount(): boolean {
  return settings.role !== 'viewer';
}

export function isSessionLocked(): boolean {
  return !!(session && session.closedAt);
}

export function guardLocked(): boolean {
  if (isSessionLocked()) {
    toast('جلسه بسته شده — شمارش ممکن نیست', 'error');
    return true;
  }
  if (!canCount()) {
    toast('نقش مشاهده‌گر اجازه شمارش ندارد', 'error');
    return true;
  }
  return false;
}

export function isQtyModalOpen(): boolean {
  return qtyModalOpen;
}

export function getLastScannedId(): string | null {
  return lastScannedId;
}

// ——— Core count operations ———

export function updateCount(id: string, value: number | string | null): boolean {
  if (guardLocked()) return false;
  const p = products.find((x) => x.id === id);
  if (!p) return false;

  const v = value === null || value === '' ? null : parseFloat(String(value));
  const next = v !== null && !isNaN(v) ? v : null;

  const usePhase2 = isDoubleCount() && countPhase() === 2;

  if (usePhase2) {
    const prev = p.countedQty2 ?? null;
    if (prev === next) return false;
    p.countedQty2 = next;
    pushUndo({
      type: 'count2',
      id: p.id,
      prev,
      next,
      name: p.name,
      ts: Date.now(),
      phase: 2,
    });
    logAudit('count2', { id: p.id, name: p.name, code: p.code || '', prev, next });
  } else {
    const prev = p.countedQty;
    if (prev === next) return false;
    p.countedQty = next;
    recordCountChange(p, prev);
  }

  save();
  notifyChange();
  return true;
}

export function adjustCount(id: string, delta: number): boolean {
  if (guardLocked()) return false;
  const p = products.find((x) => x.id === id);
  if (!p) return false;

  const usePhase2 = isDoubleCount() && countPhase() === 2;
  if (usePhase2) {
    const prev = p.countedQty2 ?? null;
    const base = p.countedQty2 ?? 0;
    p.countedQty2 = Math.max(0, base + delta);
    if (prev !== p.countedQty2) {
      pushUndo({
        type: 'count2',
        id: p.id,
        prev,
        next: p.countedQty2,
        name: p.name,
        ts: Date.now(),
        phase: 2,
      });
      logAudit('count2', {
        id: p.id,
        name: p.name,
        prev,
        next: p.countedQty2,
      });
      save();
      notifyChange();
    }
  } else {
    const prev = p.countedQty;
    p.countedQty = Math.max(0, (p.countedQty ?? 0) + delta);
    if (prev !== p.countedQty) {
      recordCountChange(p, prev);
      save();
      notifyChange();
    }
  }
  return true;
}

function recordCountChange(p: Product, prev: number | null): void {
  pushUndo({
    type: 'count',
    id: p.id,
    prev,
    next: p.countedQty,
    name: p.name,
    ts: Date.now(),
  });
  logAudit('count', {
    id: p.id,
    name: p.name,
    code: p.code || '',
    prev,
    next: p.countedQty,
  });
}

// ——— Undo ———

export function undoLast(): boolean {
  if (!canUndo()) {
    toast('چیزی برای برگشت نیست', 'info');
    return false;
  }
  if (guardLocked()) return false;

  const u = popUndo();
  if (!u) return false;

  if (u.type === 'count' && u.id) {
    const p = products.find((x) => x.id === u.id);
    if (p) {
      p.countedQty = u.prev;
      logAudit('undo', { name: p.name, restored: u.prev });
      toast('برگشت: ' + p.name + ' ← ' + (u.prev === null ? '—' : u.prev), 'success');
    }
  } else if (u.type === 'count2' && u.id) {
    const p = products.find((x) => x.id === u.id);
    if (p) {
      p.countedQty2 = u.prev;
      logAudit('undo', { name: p.name, restored: u.prev, phase: 2 });
      toast('برگشت فاز۲: ' + p.name, 'success');
    }
  } else if (u.type === 'bulk' && u.items) {
    u.items.forEach((it) => {
      const p = products.find((x) => x.id === it.id);
      if (!p) return;
      p.countedQty = it.prev;
      if (typeof it.prevSystemQty === 'number') p.systemQty = it.prevSystemQty;
      if (Object.prototype.hasOwnProperty.call(it, 'prevCountedQty2')) {
        p.countedQty2 = it.prevCountedQty2 ?? null;
      }
    });
    toast('عملیات دسته‌ای برگشت داده شد', 'success');
  }

  save();
  notifyChange();
  return true;
}

export { canUndo };

// ——— Quantity Modal ———

export function openQtyModal(p: Product): void {
  if (guardLocked()) return;

  qtyModalProduct = p;
  qtyModalOpen = true;

  const nameEl = document.getElementById('qtyModalName');
  const metaEl = document.getElementById('qtyModalMeta');
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  const modal = document.getElementById('qtyModal');

  if (nameEl) nameEl.textContent = p.name;

  if (metaEl) {
    const parts = [
      p.code || p.sku ? `کد: ${p.code || p.sku}` : null,
      `سیستم: ${formatFaNumber(p.systemQty)}`,
      p.location ? `📍 ${p.location}` : null,
      p.unit ? p.unit : null,
    ].filter(Boolean);
    metaEl.textContent = parts.join(' · ');
  }

  const usePhase2 = isDoubleCount() && countPhase() === 2;
  const current = usePhase2 ? p.countedQty2 : p.countedQty;

  if (inp) {
    // اگر autoIncrement روشن باشد و قبلاً شمارش شده، +1 پیشنهاد می‌دهیم
    if (settings.autoIncrement && current != null) {
      inp.value = String(current + 1);
    } else if (current != null) {
      inp.value = String(current);
    } else if (settings.autoIncrement) {
      inp.value = '1';
    } else {
      inp.value = '';
    }
  }

  updateQtyModalDiff();

  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('show');
  }

  setTimeout(() => {
    inp?.focus();
    inp?.select();
  }, 150);
}

export function closeQtyModal(keepCamera = true): void {
  qtyModalOpen = false;
  qtyModalProduct = null;
  const modal = document.getElementById('qtyModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('show');
  }
  // keepCamera فعلاً فقط فلگ است؛ بستن دوربین از بیرون مدیریت می‌شود
  void keepCamera;
}

export function adjustQtyModal(delta: number): void {
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  if (!inp) return;
  let v = parseFloat(inp.value);
  if (isNaN(v)) v = 0;
  inp.value = String(Math.max(0, v + delta));
  updateQtyModalDiff();
}

export function setQtyModalToSystem(): void {
  if (!qtyModalProduct) return;
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  if (inp) {
    inp.value = String(qtyModalProduct.systemQty ?? 0);
    updateQtyModalDiff();
  }
}

export function setQtyModalValue(v: number): void {
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  if (inp) {
    inp.value = String(v);
    updateQtyModalDiff();
  }
}

export function updateQtyModalDiff(): void {
  const el = document.getElementById('qtyModalDiff');
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  if (!el || !inp || !qtyModalProduct) return;

  const q = parseFloat(inp.value);
  if (isNaN(q)) {
    el.textContent = '';
    return;
  }
  if (settings.blindCount) {
    el.textContent = 'حالت کور — مغایرت بعداً محاسبه خواهد شد';
    el.style.color = 'var(--success)';
    return;
  }
  const diff = q - (qtyModalProduct.systemQty ?? 0);
  if (diff === 0) {
    el.textContent = 'تطابق با سیستم ✓';
    el.style.color = 'var(--success)';
  } else {
    el.textContent = 'مغایرت: ' + (diff > 0 ? '+' : '') + diff;
    el.style.color = diff > 0 ? 'var(--success)' : 'var(--danger)';
  }
}

export function confirmQtyModal(): boolean {
  if (!qtyModalProduct) {
    closeQtyModal(false);
    return false;
  }
  if (guardLocked()) return false;

  const p = qtyModalProduct;
  const inp = document.getElementById('qtyModalInput') as HTMLInputElement | null;
  const raw = inp?.value ?? '';
  const next = parseFloat(raw);

  if (isNaN(next) || next < 0) {
    toast('تعداد معتبر وارد کنید', 'error');
    return false;
  }

  const usePhase2 = isDoubleCount() && countPhase() === 2;

  if (usePhase2) {
    const prev = p.countedQty2 ?? null;
    if (prev !== next) {
      p.countedQty2 = next;
      pushUndo({
        type: 'count2',
        id: p.id,
        prev,
        next,
        name: p.name,
        ts: Date.now(),
        phase: 2,
      });
      logAudit('count2', { id: p.id, name: p.name, prev, next });
    }
  } else {
    const prev = p.countedQty;
    if (prev !== next) {
      p.countedQty = next;
      recordCountChange(p, prev);
    }
  }

  save();

  lastScannedId = p.id;
  lastConfirmedProductId = p.id;
  lastConfirmedAt = Date.now();
  markConfirmed(p.code || p.sku || '');

  const displayQty = usePhase2 ? (p.countedQty2 ?? next) : (p.countedQty ?? next);

  // recent scans
  const filtered = recentScans.filter((r) => r.id !== p.id);
  filtered.unshift({ id: p.id, name: p.name, qty: displayQty });
  recentScans.length = 0;
  recentScans.push(...filtered.slice(0, 30));
  saveRecentScans(recentScans);

  closeQtyModal(true);
  notifyChange();

  toast(`${p.name}: ${formatFaNumber(displayQty)}`, 'success');
  return true;
}

// ——— اتصال به اسکنر ———

/**
 * نتیجه اسکن را پردازش می‌کند:
 * - کالا پیدا نشود → خطا + پیشنهاد افزودن
 * - پیدا شود → باز کردن مودال تعداد (یا شمارش خودکار)
 */
export function handleScannedCode(
  code: string,
  options?: {
    currentLocation?: string;
    onNotFound?: (code: string) => void;
    autoConfirm?: boolean; // اگر true باشد بدون مودال +1 می‌کند
  }
): void {
  if (!canCount()) {
    toast('نقش مشاهده‌گر اجازه شمارش ندارد', 'error');
    return;
  }
  if (isSessionLocked()) {
    toast('جلسه بسته شده', 'error');
    return;
  }
  if (qtyModalOpen) return;

  const p = findProductByCode(code);

  if (!p) {
    playBeep(false);
    vibrateOnFail();
    toast('یافت نشد: ' + code, 'error');
    options?.onNotFound?.(code);
    return;
  }

  // guard اسکن تکراری همان کالا بلافاصله بعد از تأیید
  const now = Date.now();
  if (
    p.id === lastConfirmedProductId &&
    now - lastConfirmedAt < SAME_PRODUCT_SCAN_GUARD_MS
  ) {
    playBeep(false);
    toast('اسکن تکراری همین کالا نادیده گرفته شد', 'error');
    return;
  }

  // اختصاص مکان فعلی اگر خالی باشد
  if (options?.currentLocation && !p.location) {
    p.location = options.currentLocation;
  }

  playBeep(true);
  if (settings.vibrateOnScan && navigator.vibrate) {
    navigator.vibrate(40);
  }

  // حالت شمارش سریع / autoIncrement بدون مودال
  if (options?.autoConfirm || settings.quickAutoConfirm) {
    const usePhase2 = isDoubleCount() && countPhase() === 2;
    if (usePhase2) {
      const prev = p.countedQty2 ?? null;
      p.countedQty2 = (p.countedQty2 ?? 0) + 1;
      pushUndo({
        type: 'count2',
        id: p.id,
        prev,
        next: p.countedQty2,
        name: p.name,
        ts: Date.now(),
        phase: 2,
      });
      logAudit('count2', { id: p.id, name: p.name, prev, next: p.countedQty2 });
    } else {
      const prev = p.countedQty;
      p.countedQty = (p.countedQty ?? 0) + 1;
      recordCountChange(p, prev);
    }
    lastScannedId = p.id;
    lastConfirmedProductId = p.id;
    lastConfirmedAt = Date.now();
    save();
    notifyChange();
    toast(`${p.name}: ${formatFaNumber(usePhase2 ? p.countedQty2 : p.countedQty)}`, 'success');
    return;
  }

  openQtyModal(p);
}

// ——— عملیات دسته‌ای ———

export function clearAllCounts(): boolean {
  if (guardLocked()) return false;
  if (!confirm('همه شمارش‌ها پاک شوند؟')) return false;

  const items: UndoItem['items'] = [];
  products.forEach((p) => {
    if (p.countedQty !== null || p.countedQty2 != null) {
      items!.push({ id: p.id, prev: p.countedQty, prevCountedQty2: p.countedQty2 ?? null });
    }
    p.countedQty = null;
    if (p.countedQty2 != null) p.countedQty2 = null;
  });

  if (items!.length) {
    pushUndo({ type: 'bulk', items, prev: null, ts: Date.now() });
    logAudit('clear_counts', { count: items!.length });
  }

  save();
  notifyChange();
  toast('شمارش‌ها پاک شد', 'success');
  return true;
}

export function zeroUncounted(): boolean {
  if (guardLocked()) return false;
  if (!confirm('کالاهای شمارش‌نشده صفر شوند؟')) return false;

  const items: UndoItem['items'] = [];
  products.forEach((p) => {
    if (p.countedQty === null || p.countedQty === undefined) {
      items!.push({ id: p.id, prev: null });
      p.countedQty = 0;
    }
  });

  if (items!.length) {
    pushUndo({ type: 'bulk', items, prev: null, ts: Date.now() });
    logAudit('bulk_zero', { count: items!.length });
  }

  save();
  notifyChange();
  toast(`${items!.length} کالا صفر شد`, 'success');
  return true;
}
