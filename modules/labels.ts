/**
 * چاپ لیبل بارکد Code128 + عملیات دسته‌ای ارتقا‌یافته
 */

import type { Product } from '@/types';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { products, settings, logAudit, save, invalidateStats, filterByActiveWarehouse } from './state';
import { toast } from './ui';
import { guardLocked } from './count';
import { esc } from '@/utils/helpers';

const NativePrint = registerPlugin<{ printLabels(options: { html: string }): Promise<{ started: boolean }> }>('NativePrint');

// ——— Code128B ———
const CODE128_B_START = 104;
const CODE128_STOP = 106;
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function code128BEncode(text: string): { codes: number[]; text: string } | null {
  text = String(text || '');
  if (!text) return null;
  let clean = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 32 && c <= 126) clean += text[i];
  }
  if (!clean) return null;
  const codes = [CODE128_B_START];
  let checksum = CODE128_B_START;
  for (let i = 0; i < clean.length; i++) {
    const val = clean.charCodeAt(i) - 32;
    codes.push(val);
    checksum += val * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);
  return { codes, text: clean };
}

export function drawCode128ToDataUrl(
  text: string,
  opts?: { moduleWidth?: number; height?: number; quiet?: number }
): string | null {
  const enc = code128BEncode(text);
  if (!enc) return null;
  const moduleW = opts?.moduleWidth ?? 2;
  const height = opts?.height ?? 56;
  const quiet = opts?.quiet ?? 10;
  let modules = '';
  enc.codes.forEach((code) => {
    const pat = CODE128_PATTERNS[code];
    if (!pat) return;
    for (let i = 0; i < pat.length; i++) {
      const w = parseInt(pat[i], 10);
      const isBar = i % 2 === 0;
      modules += (isBar ? '1' : '0').repeat(w);
    }
  });
  const width = quiet * 2 + modules.length * moduleW;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height + 18;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  let x = quiet;
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] === '1') ctx.fillRect(x, 0, moduleW, height);
    x += moduleW;
  }
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(enc.text, width / 2, height + 14);
  return canvas.toDataURL('image/png');
}

function labelHtmlForProduct(p: Product): string {
  const code = p.code || p.sku || '';
  const bc = code ? drawCode128ToDataUrl(code, { moduleWidth: 2, height: 52 }) : null;
  return (
    '<div class="label-card">' +
    (bc ? `<img src="${bc}" alt="bc" />` : '<div class="no-bc">بدون بارکد</div>') +
    `<div class="label-name">${esc(p.name)}</div>` +
    `<div class="label-code">${esc(code)}</div>` +
    (p.location ? `<div class="label-loc">📍 ${esc(p.location)}</div>` : '') +
    '</div>'
  );
}

function ensureLabelStyles(): void {
  if (document.getElementById('label-print-styles')) return;
  const st = document.createElement('style');
  st.id = 'label-print-styles';
  st.textContent = `
    .label-sheet{display:none}
    @media print{
      body *{visibility:hidden !important}
      .label-sheet,.label-sheet *{visibility:visible !important}
      .label-sheet{display:block !important;position:fixed !important;left:0 !important;top:0 !important;width:100% !important;margin:0 !important;padding:0 !important;background:#fff !important;z-index:2147483647 !important}
      .label-card{display:inline-block !important;visibility:visible !important;background:#fff !important;color:#000 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .label-card img{display:block !important;visibility:visible !important;width:auto !important;max-width:100% !important;height:auto !important;min-height:52px;object-fit:contain;margin:0 auto;image-rendering:pixelated}
      .label-name,.label-code,.label-loc,.no-bc{visibility:visible !important;color:#000 !important}
      @page{margin:8mm}
      .nav,header,.fab,.toast,.modal-overlay{display:none !important}
    }
    .label-card{
      break-inside:avoid;page-break-inside:avoid;
      border:1px dashed #94a3b8;border-radius:8px;padding:10px;margin:8px;
      text-align:center;display:inline-block;width:220px;vertical-align:top;
      background:#fff;color:#000
    }
    .label-card img{max-width:100%;height:auto}
    .label-name{font-weight:800;font-size:13px;margin-top:6px}
    .label-code{font-family:monospace;font-size:12px;direction:ltr}
    .label-loc{font-size:11px;color:#475569;margin-top:2px}
    .no-bc{padding:20px;color:#64748b;font-size:12px}
  `;
  document.head.appendChild(st);
}

function getLabelArea(): HTMLElement {
  ensureLabelStyles();
  let area = document.getElementById('labelPrintArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'labelPrintArea';
    area.className = 'label-sheet';
    document.body.appendChild(area);
  }
  return area;
}

/** باز کردن چاپ در اندروید بومی یا پنجره چاپ مرورگر */
function openPrintDialog(area: HTMLElement): void {
  const html = `<!doctype html><html lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @page{size:auto;margin:8mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;direction:rtl}
    .label-sheet{display:block!important;width:100%;background:#fff}
    .label-card{display:inline-block;vertical-align:top;break-inside:avoid;page-break-inside:avoid;border:1px dashed #94a3b8;border-radius:8px;padding:10px;margin:6px;text-align:center;width:220px;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .label-card img{display:block;width:auto;max-width:100%;height:auto;min-height:52px;object-fit:contain;margin:0 auto;image-rendering:pixelated}
    .label-name{font-weight:800;font-size:13px;margin-top:6px}.label-code{font-family:monospace;font-size:12px;direction:ltr}.label-loc{font-size:11px;color:#475569;margin-top:2px}.no-bc{padding:20px;color:#64748b;font-size:12px}
  </style></head><body><div class="label-sheet">${area.innerHTML}</div></body></html>`;

  // داده‌های بارکد به شکل data URL ساخته می‌شوند. منتظر ماندن برای decode در بعضی WebViewها
  // می‌تواند بی‌پایان بماند؛ بنابراین مسیر چاپ را بدون انتظار نامحدود اجرا می‌کنیم.
  if (Capacitor.isNativePlatform()) {
    NativePrint.printLabels({ html }).then((result) => {
      if (result?.started) toast('پنجره چاپ اندروید باز شد؛ چاپگر را انتخاب کنید', 'success');
      else toast('سیستم چاپ پاسخی نداد؛ دوباره تلاش کنید', 'error');
    }).catch((err) => {
      console.error('[Anbarin] native print failed:', err);
      toast('چاپ اندروید باز نشد. اگر برنامه قدیمی است، APK جدید نصب کنید.', 'error');
    });
    return;
  }

  // چاپ از iframe مستقل؛ از پنهان بودن labelPrintArea و مسدودشدن پنجره چاپ جلوگیری می‌کند.
  try {
    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'پیش‌نمایش چاپ لیبل');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.border = '0';
    frame.style.opacity = '0.01';
    frame.style.pointerEvents = 'none';
    let printed = false;
    const cleanup = () => window.setTimeout(() => frame.remove(), 1500);
    frame.onload = () => {
      if (printed) return;
      printed = true;
      try {
        const w = frame.contentWindow;
        if (!w) throw new Error('print frame has no window');
        w.onafterprint = cleanup;
        w.focus();
        window.setTimeout(() => {
          try { w.print(); }
          catch (err) {
            console.error('[Anbarin] iframe print failed:', err);
            toast('مرورگر امکان باز کردن چاپ را نداد؛ در Chrome امتحان کنید', 'error');
            cleanup();
          }
          window.setTimeout(cleanup, 30000);
        }, 150);
      } catch (err) {
        console.error('[Anbarin] print frame failed:', err);
        toast('باز کردن پنجره چاپ ناموفق بود', 'error');
        cleanup();
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  } catch (err) {
    console.error('[Anbarin] browser print setup failed:', err);
    toast('آماده‌سازی چاپ ناموفق بود؛ مرورگر را دوباره باز کنید', 'error');
  }
}

/** چاپ لیبل یک کالا */
export function printProductLabel(p: Product): void {
  const area = getLabelArea();
  area.innerHTML = labelHtmlForProduct(p);
  openPrintDialog(area);
}

/** چاپ دسته‌ای تا ۵۰ کالای انبار فعال */
export function printLabelsBulk(max = 50): void {
  const list = filterByActiveWarehouse(products)
    .filter((p) => String(p.code || p.sku || '').trim().length > 0)
    .slice(0, max);
  if (!list.length) {
    toast('برای کالاهای انبار فعال، کد یا بارکدی ثبت نشده است', 'error');
    return;
  }
  const area = getLabelArea();
  area.innerHTML = list.map(labelHtmlForProduct).join('');
  logAudit('print_labels', { count: list.length });
  toast(`آماده‌سازی چاپ ${list.length} لیبل`, 'success');
  openPrintDialog(area);
}

// ——— عملیات دسته‌ای ———

/** موجودی سیستم = شمارش واقعی */
export function applyCountsToSystem(): boolean {
  if (guardLocked()) return false;
  const targets = products.filter((p) => p.countedQty !== null && p.countedQty !== undefined);
  if (!targets.length) {
    toast('شمارشی وجود ندارد', 'error');
    return false;
  }
  if (!confirm(`موجودی سیستم ${targets.length} کالا برابر شمارش واقعی شود؟`)) return false;

  targets.forEach((p) => {
    p.systemQty = p.countedQty as number;
  });
  save(true);
  invalidateStats();
  logAudit('apply_system', { count: targets.length });
  toast('موجودی سیستم به‌روز شد', 'success');
  return true;
}

/** شمارش = موجودی سیستم (برای کالاهای شمارش‌شده) */
export function resetCountsToSystem(): boolean {
  if (guardLocked()) return false;
  const targets = products.filter((p) => p.countedQty !== null);
  if (!targets.length) {
    toast('شمارشی نیست', 'info');
    return false;
  }
  if (!confirm(`شمارش ${targets.length} کالا به مقدار سیستم برگردد؟`)) return false;
  targets.forEach((p) => {
    p.countedQty = p.systemQty;
  });
  save(true);
  invalidateStats();
  logAudit('reset_counts_to_system', { count: targets.length });
  toast('شمارش‌ها با سیستم هم‌تراز شد', 'success');
  return true;
}
