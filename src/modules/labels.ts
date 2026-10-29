/**
 * چاپ لیبل بارکد Code128 + عملیات دسته‌ای ارتقا‌یافته
 */

import type { Product } from '@/types';
import { products, settings, logAudit, save, invalidateStats, filterByActiveWarehouse } from './state';
import { toast } from './ui';
import { guardLocked } from './count';
import { esc } from '@/utils/helpers';

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
      .label-sheet{display:block !important;position:absolute;left:0;top:0;width:100%}
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

/** چاپ لیبل یک کالا */
export function printProductLabel(p: Product): void {
  const area = getLabelArea();
  area.innerHTML = labelHtmlForProduct(p);
  window.print();
}

/** چاپ دسته‌ای تا ۵۰ کالای انبار فعال */
export function printLabelsBulk(max = 50): void {
  const list = filterByActiveWarehouse(products)
    .filter((p) => p.code || p.sku)
    .slice(0, max);
  if (!list.length) {
    toast('کالایی با بارکد برای چاپ نیست', 'error');
    return;
  }
  const area = getLabelArea();
  area.innerHTML = list.map(labelHtmlForProduct).join('');
  logAudit('print_labels', { count: list.length });
  window.print();
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
