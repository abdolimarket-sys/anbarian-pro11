/**
 * فیلتر مکان/انبار + اعمال نقش در کل UI
 * هدف: بدون عقبگرد نسبت به نسخه قدیم + کنترل یکدست‌تر
 */

import { products, settings, filterByActiveWarehouse } from './state';
import type { Product } from '@/types';
import { toast } from './ui';

export let locationFilter = '';
export let warehouseFilterMode: 'active' | 'all' = 'active';

export function setLocationFilter(loc: string): void {
  locationFilter = (loc || '').trim();
}

export function setWarehouseFilterMode(mode: 'active' | 'all'): void {
  warehouseFilterMode = mode;
}

/** همه محل‌های یکتا (از کالاها) */
export function collectLocations(): string[] {
  const set = new Set<string>();
  for (const p of products) {
    const loc = (p.location || '').trim();
    if (loc) set.add(loc);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fa'));
}

export function collectWarehouses(): string[] {
  const set = new Set<string>(settings.warehouses || []);
  for (const p of products) {
    const w = (p.warehouse || '').trim();
    if (w) set.add(w);
  }
  if (settings.currentWarehouse) set.add(settings.currentWarehouse);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'fa'));
}

/** فیلتر ترکیبی انبار + محل + اختیاری جستجو */
export function filterProductsAdvanced(
  opts: {
    query?: string;
    location?: string;
    onlyWarehouse?: boolean;
    countFilter?: 'all' | 'counted' | 'uncounted' | 'diff';
  } = {}
): Product[] {
  let list =
    opts.onlyWarehouse === false || warehouseFilterMode === 'all'
      ? [...products]
      : filterByActiveWarehouse(products);

  const loc = (opts.location ?? locationFilter).trim().toLowerCase();
  if (loc) {
    list = list.filter((p) => (p.location || '').toLowerCase().includes(loc));
  }

  const cf = opts.countFilter;
  if (cf === 'counted') list = list.filter((p) => p.countedQty != null);
  else if (cf === 'uncounted') list = list.filter((p) => p.countedQty == null);
  else if (cf === 'diff')
    list = list.filter((p) => p.countedQty != null && p.countedQty !== p.systemQty);

  const q = (opts.query || '').trim().toLowerCase();
  if (q) {
    list = list.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.code && String(p.code).toLowerCase().includes(q)) ||
        (p.sku && String(p.sku).toLowerCase().includes(q)) ||
        (p.location && String(p.location).toLowerCase().includes(q)) ||
        (p.note && String(p.note).toLowerCase().includes(q))
    );
  }
  return list;
}

export function isViewer(): boolean {
  return settings.role === 'viewer';
}

export function isAdmin(): boolean {
  return settings.role === 'admin' || !settings.role;
}

export function isCounter(): boolean {
  return settings.role === 'counter' || isAdmin();
}

/** اعمال محدودیت نقش روی دکمه‌ها و فرم‌ها */
export function applyRoleUI(): void {
  const viewer = isViewer();
  const admin = isAdmin();

  // دکمه‌هایی که مشاهده‌گر نباید بزند
  const writeSelectors = [
    '#btnOpenScanner',
    '#btnQuickCount',
    '#btnTakePhoto',
    '#btnAddProduct',
    '#btnStartSession',
    '#btnCloseSession',
    '#undoBtn',
    '#btnClearCounts',
    '#btnZeroUncounted',
    '#btnApplySystem',
    '#btnResetToSystem',
    '#btnImport',
    '#btnImportTeam',
    '#btnImportPhotos',
    '#btnActivateLicense',
    '#btnDeactivateLicense',
    '#btnExportTeam',
    '#qtyConfirm',
  ];

  writeSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      const btn = el as HTMLButtonElement;
      if (viewer) {
        btn.disabled = true;
        btn.title = 'نقش مشاهده‌گر — فقط مشاهده';
        btn.classList.add('role-locked');
      } else {
        if (btn.id === 'undoBtn') return; // undo جدا مدیریت می‌شود
        btn.disabled = false;
        btn.title = '';
        btn.classList.remove('role-locked');
      }
    });
  });

  // تنظیمات حساس فقط ادمین
  // انتخاب نقش و ذخیره تنظیمات باید همیشه در دسترس بماند؛ وگرنه با انتخاب نقش غیرمدیر،
  // امکان برگشت به نقش مدیر از داخل برنامه از بین می‌رود.
  const adminOnly = ['#btnClearAudit', '#btnDeactivateLicense'];
  adminOnly.forEach((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | HTMLButtonElement | null;
    if (!el) return;
    if (!admin) {
      el.setAttribute('disabled', 'true');
      el.classList.add('role-locked');
    } else {
      el.removeAttribute('disabled');
      el.classList.remove('role-locked');
    }
  });

  const badge = document.getElementById('roleBadge');
  if (badge) {
    badge.textContent =
      settings.role === 'viewer' ? 'مشاهده‌گر' : settings.role === 'counter' ? 'شمارنده' : 'مدیر';
  }
}

export function guardWrite(feature = 'این عمل'): boolean {
  if (isViewer()) {
    toast('نقش مشاهده‌گر اجازه «' + feature + '» ندارد', 'error');
    return false;
  }
  return true;
}

/** پر کردن select محل‌ها */
export function fillLocationSelect(selectId = 'locationFilterSelect'): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!sel) return;
  const current = sel.value;
  const locs = collectLocations();

  // نام محل ممکن است از فایل اکسل یا ورودی کاربر آمده باشد؛ آن را به‌صورت متن
  // درج می‌کنیم تا کاراکترهای HTML به‌عنوان کد اجرا یا تفسیر نشوند.
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'همه محل‌ها';
  sel.replaceChildren(allOption);
  for (const loc of locs) {
    const option = document.createElement('option');
    option.value = loc;
    option.textContent = loc;
    sel.appendChild(option);
  }
  if (current && locs.includes(current)) sel.value = current;
  else if (locationFilter && locs.includes(locationFilter)) sel.value = locationFilter;
}
