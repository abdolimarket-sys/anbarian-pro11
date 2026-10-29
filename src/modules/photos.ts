/**
 * مدیریت عکس کالا
 * - گرفتن از دوربین / گالری
 * - فشرده‌سازی JPEG
 * - نمایش / حذف
 * - خروجی و ورود بسته عکس‌ها
 */

import type { Product } from '@/types';
import { products, logAudit, save, invalidateStats } from './state';
import { toast } from './ui';
import { downloadFile, dateStr } from '@/utils/helpers';
import { getLastScannedId } from './count';

let photoTargetId: string | null = null;
let onPhotoChanged: (() => void) | null = null;

export function setPhotoChangeListener(fn: (() => void) | null): void {
  onPhotoChanged = fn;
}

function notify(): void {
  invalidateStats();
  onPhotoChanged?.();
}

export function setPhotoTarget(id: string | null): void {
  photoTargetId = id;
}

export function getPhotoTarget(): string | null {
  return photoTargetId || getLastScannedId();
}

/** فشرده‌سازی تصویر به JPEG با حداکثر عرض */
export function compressImageDataUrl(
  dataUrl: string,
  maxW = 900,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(c.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** باز کردن انتخابگر فایل / دوربین */
export function captureProductPhoto(productId?: string): void {
  const id = productId || photoTargetId || getLastScannedId();
  if (!id) {
    toast('ابتدا یک کالا را اسکن یا انتخاب کنید', 'error');
    return;
  }
  photoTargetId = id;

  let inp = document.getElementById('productPhotoInput') as HTMLInputElement | null;
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'productPhotoInput';
    inp.accept = 'image/*';
    inp.capture = 'environment';
    inp.style.display = 'none';
    inp.addEventListener('change', onProductPhotoSelected);
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.click();
}

async function onProductPhotoSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const id = photoTargetId || getLastScannedId();
  if (!id) return;

  const p = products.find((x) => x.id === id);
  if (!p) return;

  if (file.size > 8 * 1024 * 1024) {
    toast('حجم عکس زیاد است (حداکثر حدود ۸ مگ)', 'error');
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    const compressed = await compressImageDataUrl(dataUrl, 900, 0.72);
    p.photo = compressed;
    p.photoAt = new Date().toISOString();
    save();
    logAudit('photo', { id: p.id, name: p.name });
    toast('عکس ذخیره شد', 'success');
    notify();
    showPhotoModal(p.id);
  } catch {
    toast('خطا در ذخیره عکس', 'error');
  }
  input.value = '';
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function showPhotoModal(id: string): void {
  const p = products.find((x) => x.id === id);
  if (!p) return;

  photoTargetId = id;

  let modal = document.getElementById('photoModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'photoModal';
    modal.className = 'modal-overlay';
    modal.style.cssText =
      'display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:270;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
      <div class="modal-card" style="max-width:400px;width:100%">
        <div id="photoModalBody" style="text-align:center"></div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
          <button class="btn btn-primary btn-block" id="photoCaptureBtn">📷 گرفتن / تعویض عکس</button>
          <button class="btn btn-secondary btn-block" id="photoRemoveBtn">حذف عکس</button>
          <button class="btn btn-secondary btn-block" id="photoCloseBtn">بستن</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#photoCaptureBtn')?.addEventListener('click', () => {
      captureProductPhoto(photoTargetId || undefined);
    });
    modal.querySelector('#photoRemoveBtn')?.addEventListener('click', () => removeProductPhoto());
    modal.querySelector('#photoCloseBtn')?.addEventListener('click', () => closePhotoModal());
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closePhotoModal();
    });
  }

  const body = document.getElementById('photoModalBody');
  if (body) {
    if (p.photo) {
      body.innerHTML = '';
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = 'photo';
      img.style.cssText = 'max-width:100%;max-height:55vh;border-radius:12px';
      body.appendChild(img);
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.style.marginTop = '8px';
      hint.textContent =
        p.name + (p.photoAt ? ' · ' + new Date(p.photoAt).toLocaleString('fa-IR') : '');
      body.appendChild(hint);
    } else {
      body.innerHTML = '';
      const h = document.createElement('p');
      h.className = 'hint';
      h.textContent = 'عکسی ثبت نشده — دکمه گرفتن عکس را بزنید';
      const n = document.createElement('p');
      n.style.fontWeight = '700';
      n.textContent = p.name;
      body.appendChild(h);
      body.appendChild(n);
    }
  }

  modal.style.display = 'flex';
}

export function closePhotoModal(): void {
  const modal = document.getElementById('photoModal');
  if (modal) modal.style.display = 'none';
}

export function removeProductPhoto(): void {
  const id = photoTargetId || getLastScannedId();
  const p = products.find((x) => x.id === id);
  if (!p || !p.photo) {
    toast('عکسی نیست', 'info');
    return;
  }
  if (!confirm('عکس حذف شود؟')) return;
  delete p.photo;
  delete p.photoAt;
  save();
  toast('عکس حذف شد', 'success');
  notify();
  if (id) showPhotoModal(id);
}

/** خروجی بسته عکس‌ها */
export function exportPhotosPack(): void {
  const items = products
    .filter((p) => p.photo)
    .map((p) => ({
      id: p.id,
      code: p.code || '',
      name: p.name,
      note: p.note || '',
      photoAt: p.photoAt || '',
      photo: p.photo,
    }));
  if (!items.length) {
    toast('هیچ عکسی ثبت نشده', 'info');
    return;
  }
  const pack = {
    type: 'anbar-photos-pack',
    version: 1,
    savedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  downloadFile(
    JSON.stringify(pack),
    `anbar-photos-${dateStr()}.json`,
    'application/json'
  );
  logAudit('export_photos', { count: items.length });
  toast(`${items.length} عکس صادر شد`, 'success');
}

/** ورود بسته عکس‌ها */
export async function importPhotosPack(file: File): Promise<number> {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== 'anbar-photos-pack' || !Array.isArray(data.items)) {
      toast('بسته عکس معتبر نیست', 'error');
      return 0;
    }
    let n = 0;
    for (const it of data.items) {
      if (!it.photo) continue;
      let p: Product | undefined;
      if (it.id) p = products.find((x) => x.id === it.id);
      if (!p && it.code) {
        p = products.find(
          (x) =>
            (x.code && String(x.code) === String(it.code)) ||
            (x.sku && String(x.sku) === String(it.code))
        );
      }
      if (p) {
        p.photo = it.photo;
        p.photoAt = it.photoAt || new Date().toISOString();
        n++;
      }
    }
    if (n) {
      save(true);
      notify();
      logAudit('import_photos', { count: n });
    }
    toast(n ? `${n} عکس وارد شد` : 'تطبیقی پیدا نشد', n ? 'success' : 'info');
    return n;
  } catch {
    toast('خطا در خواندن بسته عکس', 'error');
    return 0;
  }
}

export function countPhotos(): number {
  return products.filter((p) => p.photo).length;
}
