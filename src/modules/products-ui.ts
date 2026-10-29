/**
 * مدیریت کالا — افزودن / ویرایش / حذف
 * ارتقا نسبت به نسخه یک‌فایلی: جدا، type-safe، قابل اتصال به لیست مجازی
 */

import type { Product } from '@/types';
import {
  products,
  settings,
  save,
  rebuildIndex,
  invalidateStats,
  logAudit,
  findProductByCode,
} from './state';
import { toast } from './ui';
import { generateId } from '@/utils/helpers';
import { canCount, guardLocked } from './count';

let editingId: string | null = null;
let onProductsChanged: (() => void) | null = null;

export function setProductsChangeListener(fn: (() => void) | null): void {
  onProductsChanged = fn;
}

function notify(): void {
  rebuildIndex();
  invalidateStats();
  onProductsChanged?.();
}

function ensureModal(): HTMLElement {
  let modal = document.getElementById('productModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'productModal';
  modal.className = 'modal-overlay';
  modal.style.cssText =
    'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:260;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:420px;width:100%;max-height:90vh;overflow:auto">
      <h2 id="productModalTitle" style="margin-bottom:12px;color:var(--primary-dark)">کالای جدید</h2>
      <form id="productForm">
        <input type="hidden" id="productId" />
        <label class="field"><span>نام *</span><input id="productName" required autocomplete="off" /></label>
        <label class="field"><span>بارکد</span><input id="productCode" direction="ltr" style="direction:ltr;text-align:left" autocomplete="off" /></label>
        <label class="field"><span>کد کالا (SKU)</span><input id="productSku" style="direction:ltr;text-align:left" autocomplete="off" /></label>
        <div style="display:flex;gap:8px">
          <label class="field" style="flex:1"><span>موجودی سیستم</span><input id="productSystemQty" type="number" step="any" value="0" /></label>
          <label class="field" style="flex:1"><span>واحد</span><input id="productUnit" value="عدد" /></label>
        </div>
        <div style="display:flex;gap:8px">
          <label class="field" style="flex:1"><span>قیمت</span><input id="productPrice" type="number" step="any" value="0" /></label>
          <label class="field" style="flex:1"><span>ضریب واحد</span><input id="productUnitFactor" type="number" step="any" value="1" /></label>
        </div>
        <div style="display:flex;gap:8px">
          <label class="field" style="flex:1"><span>حداقل</span><input id="productMinQty" type="number" step="any" /></label>
          <label class="field" style="flex:1"><span>حداکثر</span><input id="productMaxQty" type="number" step="any" /></label>
        </div>
        <label class="field"><span>محل / قفسه</span><input id="productLocation" autocomplete="off" /></label>
        <label class="field"><span>انبار</span><input id="productWarehouse" autocomplete="off" /></label>
        <div style="display:flex;gap:8px">
          <label class="field" style="flex:1"><span>سریال</span><input id="productSerial" /></label>
          <label class="field" style="flex:1"><span>بچ</span><input id="productBatch" /></label>
        </div>
        <label class="field"><span>تاریخ انقضا</span><input id="productExpiry" type="date" /></label>
        <label class="field"><span>یادداشت</span><textarea id="productNote" rows="2"></textarea></label>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button type="button" class="btn btn-secondary" id="productCancel" style="flex:1">انصراف</button>
          <button type="submit" class="btn btn-primary" style="flex:1.4">ذخیره</button>
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="productDelete" style="margin-top:8px;display:none;color:var(--danger)">حذف کالا</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // styles for fields once
  if (!document.getElementById('product-form-styles')) {
    const st = document.createElement('style');
    st.id = 'product-form-styles';
    st.textContent = `
      .field{display:block;margin-bottom:8px;font-size:.82rem;font-weight:700;color:var(--text-soft)}
      .field span{display:block;margin-bottom:4px}
      .field input,.field textarea{
        width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);
        background:var(--bg);color:var(--text);font-size:.95rem;font-weight:600
      }
      .field textarea{resize:vertical}
    `;
    document.head.appendChild(st);
  }

  modal.querySelector('#productCancel')?.addEventListener('click', () => closeProductModal());
  modal.querySelector('#productDelete')?.addEventListener('click', () => {
    if (editingId) deleteProduct(editingId);
  });
  modal.querySelector('#productForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProductFromForm();
  });
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeProductModal();
  });

  return modal;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value?.trim() || '';
}

function num(id: string): number {
  const v = parseFloat(val(id));
  return isNaN(v) ? 0 : v;
}

function numOrNull(id: string): number | null {
  const raw = val(id);
  if (raw === '') return null;
  const v = parseFloat(raw);
  return isNaN(v) ? null : v;
}

export function openProductModal(id?: string | null, presetCode?: string): void {
  if (!canCount() && settings.role === 'viewer') {
    toast('نقش مشاهده‌گر اجازه ویرایش کالا ندارد', 'error');
    return;
  }

  const modal = ensureModal();
  const title = document.getElementById('productModalTitle');
  const delBtn = document.getElementById('productDelete') as HTMLButtonElement | null;

  editingId = id || null;

  const fields = [
    'productId',
    'productName',
    'productCode',
    'productSku',
    'productSystemQty',
    'productUnit',
    'productPrice',
    'productUnitFactor',
    'productMinQty',
    'productMaxQty',
    'productLocation',
    'productWarehouse',
    'productSerial',
    'productBatch',
    'productExpiry',
    'productNote',
  ];
  fields.forEach((fid) => {
    const el = document.getElementById(fid) as HTMLInputElement | null;
    if (el) el.value = '';
  });

  (document.getElementById('productUnit') as HTMLInputElement).value = 'عدد';
  (document.getElementById('productUnitFactor') as HTMLInputElement).value = '1';
  (document.getElementById('productSystemQty') as HTMLInputElement).value = '0';
  (document.getElementById('productPrice') as HTMLInputElement).value = '0';
  (document.getElementById('productWarehouse') as HTMLInputElement).value =
    settings.currentWarehouse || 'انبار اصلی';

  if (id) {
    const p = products.find((x) => x.id === id);
    if (!p) {
      toast('کالا پیدا نشد', 'error');
      return;
    }
    if (title) title.textContent = 'ویرایش کالا';
    if (delBtn) delBtn.style.display = 'block';
    (document.getElementById('productId') as HTMLInputElement).value = p.id;
    (document.getElementById('productName') as HTMLInputElement).value = p.name || '';
    (document.getElementById('productCode') as HTMLInputElement).value = p.code || '';
    (document.getElementById('productSku') as HTMLInputElement).value = p.sku || '';
    (document.getElementById('productSystemQty') as HTMLInputElement).value = String(p.systemQty ?? 0);
    (document.getElementById('productUnit') as HTMLInputElement).value = p.unit || 'عدد';
    (document.getElementById('productPrice') as HTMLInputElement).value = String(p.price ?? 0);
    (document.getElementById('productUnitFactor') as HTMLInputElement).value = String(p.unitFactor ?? 1);
    (document.getElementById('productMinQty') as HTMLInputElement).value =
      p.minQty != null ? String(p.minQty) : '';
    (document.getElementById('productMaxQty') as HTMLInputElement).value =
      p.maxQty != null ? String(p.maxQty) : '';
    (document.getElementById('productLocation') as HTMLInputElement).value = p.location || '';
    (document.getElementById('productWarehouse') as HTMLInputElement).value =
      p.warehouse || settings.currentWarehouse || '';
    (document.getElementById('productSerial') as HTMLInputElement).value = p.serial || '';
    (document.getElementById('productBatch') as HTMLInputElement).value = p.batch || '';
    (document.getElementById('productExpiry') as HTMLInputElement).value = p.expiry || '';
    (document.getElementById('productNote') as HTMLTextAreaElement).value = p.note || '';
  } else {
    if (title) title.textContent = 'کالای جدید';
    if (delBtn) delBtn.style.display = 'none';
    if (presetCode) {
      (document.getElementById('productCode') as HTMLInputElement).value = presetCode;
    }
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('productName')?.focus(), 100);
}

export function closeProductModal(): void {
  const modal = document.getElementById('productModal');
  if (modal) modal.style.display = 'none';
  editingId = null;
}

export function saveProductFromForm(): boolean {
  if (guardLocked()) return false;

  const name = val('productName');
  if (!name) {
    toast('نام الزامی است', 'error');
    return false;
  }

  const id = val('productId');
  const data = {
    name,
    code: val('productCode'),
    sku: val('productSku'),
    unit: val('productUnit') || 'عدد',
    unitFactor: num('productUnitFactor') || 1,
    systemQty: num('productSystemQty'),
    price: num('productPrice'),
    minQty: numOrNull('productMinQty'),
    maxQty: numOrNull('productMaxQty'),
    location: val('productLocation'),
    warehouse: val('productWarehouse') || settings.currentWarehouse || 'انبار اصلی',
    serial: val('productSerial'),
    batch: val('productBatch'),
    expiry: val('productExpiry'),
    note: val('productNote'),
  };

  // جلوگیری از بارکد تکراری روی کالای دیگر
  if (data.code) {
    const other = findProductByCode(data.code);
    if (other && other.id !== id) {
      toast('این بارکد قبلاً برای کالای دیگری ثبت شده', 'error');
      return false;
    }
  }

  if (id) {
    const idx = products.findIndex((x) => x.id === id);
    if (idx < 0) {
      toast('کالا پیدا نشد', 'error');
      return false;
    }
    products[idx] = { ...products[idx], ...data };
    logAudit('product_edit', { id, name: data.name, code: data.code });
    toast('ویرایش شد', 'success');
  } else {
    const p: Product = {
      id: generateId('p'),
      ...data,
      countedQty: null,
      createdAt: new Date().toISOString(),
    };
    products.push(p);
    logAudit('product_add', { id: p.id, name: p.name, code: p.code });
    toast('اضافه شد', 'success');
  }

  save(true);
  notify();
  closeProductModal();
  return true;
}

export function deleteProduct(id: string): boolean {
  if (guardLocked()) return false;
  if (!confirm('این کالا حذف شود؟')) return false;
  const idx = products.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  const name = products[idx].name;
  products.splice(idx, 1);
  save(true);
  logAudit('product_delete', { id, name });
  toast('حذف شد', 'success');
  notify();
  closeProductModal();
  return true;
}

/** اتصال از اسکن «یافت نشد» */
export function offerAddProduct(code: string): void {
  if (confirm('کالایی با بارکد «' + code + '» نیست. اضافه شود؟')) {
    openProductModal(null, code);
  }
}
