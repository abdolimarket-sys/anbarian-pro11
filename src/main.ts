/**
 * نقطه ورود برنامه انبارین
 * فاز ۱: معماری ماژولار + اسکنر + شمارش + import/export + virtual list
 */

import './styles/main.css';
import {
  bootState,
  products,
  settings,
  getCountStats,
  storageBackend,
  session,
} from './modules/state';
import { toast, showPage, loadTheme } from './modules/ui';
import { findProductByCode } from './modules/state';

// پیام نهایی ذخیره‌سازی فایل در اپ اندروید (پس از انتخاب پوشه و نوشتن موفق).
window.addEventListener('anbarin:file-saved', (event: Event) => {
  const detail = (event as CustomEvent<{ filename?: string }>).detail;
  toast(`گزارش با موفقیت ذخیره شد: ${detail?.filename || 'فایل'}`, 'success');
});
window.addEventListener('anbarin:file-save-error', () => {
  toast('ذخیره گزارش ناموفق بود؛ دوباره تلاش کنید.', 'error');
});
import { formatFaNumber } from './utils/helpers';
import {
  initScanner,
  openScanner,
  closeScanner,
  submitManualBarcode,
  toggleTorch,
  restartCamera,
  getScannerCapabilities,
  type ScanResult,
} from './modules/scanner';
import {
  handleScannedCode,
  confirmQtyModal,
  closeQtyModal,
  adjustQtyModal,
  setQtyModalToSystem,
  updateQtyModalDiff,
  undoLast,
  canUndo,
  isQtyModalOpen,
  canCount,
  setCountChangeListener,
} from './modules/count';
import {
  exportExcel,
  exportCSV,
  exportJSON,
  processImportFile,
  loadSheetJS,
} from './modules/import-export';
import {
  getSessionLabel,
  actionStartSession,
  actionCloseSession,
  actionClearCounts,
  actionZeroUncounted,
  applySettingsFromForm,
  fillSettingsForm,
  actionSetPhase,
} from './modules/session-settings';
import {
  renderReportHTML,
  copyTextReport,
  exportAccountingDoc,
  exportDoubleCountMismatches,
  exportStockAlerts,
  exportDiffsExcel,
  exportBarcodeQuantityExcel,
  initAccountingTemplateUI,
} from './modules/reports';
import {
  captureProductPhoto,
  showPhotoModal,
  exportPhotosPack,
  importPhotosPack,
  setPhotoChangeListener,
  countPhotos,
} from './modules/photos';
import {
  exportTeamSyncPack,
  importTeamSyncPack,
  exportPartialCount,
  copyTeamSessionCode,
  joinTeamSession,
  exportTeamConflictReport,
  refreshTeamSyncUI,
} from './modules/team-sync';
import { fillLiveConfigForm, getTeamSyncMode, setTeamSyncMode, saveLiveConfig, startLiveSync, stopLiveSync, notifyTeamLiveChange } from './modules/team-live';
import {
  openProductModal,
  offerAddProduct,
  setProductsChangeListener,
} from './modules/products-ui';
import {
  renderAuditList,
  exportAuditCSV,
  clearAuditLog,
  ensureAuditStyles,
} from './modules/audit-ui';
import {
  printLabelsBulk,
  applyCountsToSystem,
  resetCountsToSystem,
} from './modules/labels';
import {
  updateLicenseUI,
  activateLicenseFromInput,
  deactivateLicense,
  requirePremium,
  getDeviceId,
} from './modules/license';
import {
  filterProductsAdvanced,
  setLocationFilter,
  locationFilter,
  fillLocationSelect,
  applyRoleUI,
  guardWrite,
} from './modules/filters-roles';
import { createVirtualList, type VirtualListHandle } from './modules/virtual-list';
import type { Product } from './types';

let productsVList: VirtualListHandle | null = null;
let countVList: VirtualListHandle | null = null;
let productSearchQuery = '';
let countFilter: 'all' | 'counted' | 'uncounted' | 'diff' = 'all';

function getFilteredProducts(): Product[] {
  return filterProductsAdvanced({
    query: productSearchQuery,
    location: locationFilter,
  });
}

function getFilteredCountList(): Product[] {
  return filterProductsAdvanced({
    query: productSearchQuery,
    location: locationFilter,
    countFilter,
  });
}

function renderProductRow(p: Product): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vrow';
  const counted =
    p.countedQty != null
      ? `<span class="vrow-badge">شمارش: ${formatFaNumber(p.countedQty)}</span>`
      : '';
  el.innerHTML = `
    <div class="vrow-main">
      <div class="vrow-name"></div>
      <div class="vrow-meta"></div>
    </div>
    <div class="vrow-side">
      <span class="vrow-sys">${formatFaNumber(p.systemQty)}</span>
      ${counted}
    </div>
  `;
  (el.querySelector('.vrow-name') as HTMLElement).textContent = p.name;
  (el.querySelector('.vrow-meta') as HTMLElement).textContent =
    `${p.code || p.sku || '—'}${p.location ? ' · 📍 ' + p.location : ''}`;
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => openProductModal(p.id));
  return el;
}

function renderCountRow(p: Product): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vrow vrow-count';
  el.dataset.id = p.id;
  const c = p.countedQty;
  let diffHtml = '';
  if (c != null && c !== p.systemQty) {
    const d = c - p.systemQty;
    const color = d > 0 ? 'var(--success)' : 'var(--danger)';
    diffHtml = `<span class="vrow-diff" style="color:${color}">${d > 0 ? '+' : ''}${d}</span>`;
  }
  const photoIcon = p.photo ? ' 📷' : '';
  el.innerHTML = `
    <div class="vrow-main">
      <div class="vrow-name"></div>
      <div class="vrow-meta"></div>
    </div>
    <div class="vrow-side">
      <span class="vrow-count-val">${c == null ? '—' : formatFaNumber(c)}</span>
      ${diffHtml}
    </div>
  `;
  (el.querySelector('.vrow-name') as HTMLElement).textContent = p.name + photoIcon;
  (el.querySelector('.vrow-meta') as HTMLElement).textContent =
    `${p.code || p.sku || '—'} · سیستم: ${formatFaNumber(p.systemQty)}`;
  el.addEventListener('click', (ev) => {
    // double-purpose: long-press style via alt or if photo exists open modal
    if (p.photo || (ev as MouseEvent).altKey) {
      showPhotoModal(p.id);
    }
  });
  return el;
}

function setupVirtualLists() {
  const prodBox = document.getElementById('productsVList');
  if (prodBox) {
    productsVList?.destroy();
    productsVList = createVirtualList<Product>({
      container: prodBox,
      rowHeight: 64,
      overscan: 8,
      getItems: getFilteredProducts,
      renderRow: (p) => renderProductRow(p),
      getKey: (p) => p.id,
    });
  }

  const countBox = document.getElementById('countVList');
  if (countBox) {
    countVList?.destroy();
    countVList = createVirtualList<Product>({
      container: countBox,
      rowHeight: 68,
      overscan: 8,
      getItems: getFilteredCountList,
      renderRow: (p) => renderCountRow(p),
      getKey: (p) => p.id,
    });
  }
}

function refreshLists() {
  fillLocationSelect();
  fillLocationSelect('locationFilterSelectProducts');
  productsVList?.refresh();
  countVList?.refresh();
  const pc = document.getElementById('productCount');
  if (pc) pc.textContent = formatFaNumber(getFilteredProducts().length);
  const cc = document.getElementById('countListCount');
  if (cc) cc.textContent = formatFaNumber(getFilteredCountList().length);
}

async function bootApp() {
  try {
    loadTheme();
    const source = await bootState();
    console.log('[Anbarin] boot source:', source, '| products:', products.length);

    renderShell();
    if (getTeamSyncMode() === 'live') void startLiveSync();
    initScannerModule();
    setCountChangeListener(() => {
      updateHeader();
      updateUndoBtn();
      refreshLists();
      notifyTeamLiveChange();
    });
    updateHeader();
    updateCapsInfo();
    updateUndoBtn();
    fillSettingsForm();
    refreshLists();
    loadSheetJS().then((ok) => console.log('[Anbarin] SheetJS:', ok));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(
        (r) => console.log('[Anbarin] SW registered', r.scope),
        (e) => console.warn('[Anbarin] SW failed', e)
      );
    }

    if (source === 'localStorage-migrated') {
      toast('داده‌ها به حافظه امن (IndexedDB) منتقل شد', 'success');
    } else if (source === 'empty') {
      toast('خوش آمدید — ابتدا کالاها را وارد کنید', 'info');
    }
  } catch (err) {
    console.error('bootApp failed', err);
    toast('خطا در بارگذاری داده‌ها', 'error');
  }
}

function initScannerModule() {
  initScanner({
    containerId: 'scanner-container',
    getSettings: () => settings,
    canScan: () => canCount(),
    isQtyModalOpen: () => isQtyModalOpen(),
    onScan: (result: ScanResult) => {
      handleScannedCode(result.code, {
        onNotFound: (code) => offerAddProduct(code),
      });
      const info = document.getElementById('lastScanInfo');
      if (info) {
        const product = findProductByCode(result.code);
        info.textContent = product ? `کالای انتخاب‌شده: ${product.name}` : `کالایی با بارکد ${result.code} پیدا نشد`;
      }
    },
    onFieldFill: (fieldId, code) => {
      const el = document.getElementById(fieldId) as HTMLInputElement | null;
      if (el) el.value = code;
    },
  });
}

function renderShell() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <header>
      <div class="header-top">
        <div class="logo-area">
          <img class="app-logo" src="./logo.png" alt="لوگوی انبارین" width="42" height="42" decoding="async" />
          <div class="logo-copy">
            <strong>انبارین</strong>
            <span class="version">نسخه ۱.۴.۲</span>
            <span class="role-badge" id="roleBadge">—</span>
          </div>
        </div>
        <div class="header-stats" id="headerStats"></div>
      </div>
    </header>

    <main>
      <section class="page active" id="page-count">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <h2 style="margin:0">شمارش انبار</h2>
            <button class="btn btn-sm btn-secondary" id="undoBtn" disabled title="برگشت آخرین عمل">↩ Undo</button>
          </div>
          <p class="hint" id="sessionHint">—</p>
          <div id="statsBox" class="stats-grid"></div>

          <div id="phaseBar" class="phase-bar" style="display:none;margin-top:10px">
            <button type="button" class="filter-chip" data-phase="1">فاز ۱</button>
            <button type="button" class="filter-chip" data-phase="2">فاز ۲</button>
          </div>

          <div class="session-bar" id="sessionBar">
            <span id="sessionLabel" class="hint">—</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-sm btn-primary" id="btnStartSession">جلسه جدید</button>
              <button class="btn btn-sm btn-secondary" id="btnCloseSession">بستن جلسه</button>
            </div>
          </div>

          <div class="actions" style="margin-top:16px">
            <button class="btn btn-primary" id="btnOpenScanner">📷 باز کردن اسکنر</button>
            <button class="btn btn-secondary" id="btnQuickCount">⚡ شمارش سریع (+۱)</button>
            <button class="btn btn-secondary" id="btnTakePhoto">🖼 عکس کالای آخر</button>
          </div>
          <p class="hint" id="lastScanInfo" style="margin-top:8px"></p>
          <p class="hint" id="btStatus" style="margin-top:4px;direction:ltr;text-align:left"></p>

          <div style="margin-top:16px">
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              <button type="button" class="filter-chip active" data-cf="all">همه</button>
              <button type="button" class="filter-chip" data-cf="counted">شمارش‌شده</button>
              <button type="button" class="filter-chip" data-cf="uncounted">مانده</button>
              <button type="button" class="filter-chip" data-cf="diff">مغایرت</button>
            </div>
            <input type="search" id="searchCount" placeholder="جستجو در شمارش..." class="search-input" />
            <select id="locationFilterSelect" class="search-input" style="margin-top:8px">
              <option value="">همه محل‌ها</option>
            </select>
            <p class="hint" style="margin-top:6px">نمایش: <strong id="countListCount">0</strong></p>
            <div id="countVList" class="vlist"></div>
          </div>
        </div>
      </section>

      <section class="page" id="page-products">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <h2 style="margin:0">لیست کالاها</h2>
            <button class="btn btn-sm btn-primary" id="btnAddProduct">＋ کالا</button>
          </div>
          <p class="hint" style="margin-top:8px">نمایش: <strong id="productCount">0</strong></p>
          <input type="search" id="searchProducts" placeholder="جستجو نام / بارکد / محل..." class="search-input" style="margin-top:10px" />
          <select id="locationFilterSelectProducts" class="search-input" style="margin-top:8px">
            <option value="">همه محل‌ها</option>
          </select>
          <div id="productsVList" class="vlist vlist-tall" style="margin-top:12px"></div>
        </div>
      </section>

      <section class="page" id="page-reports">
        <div class="card">
          <h2>گزارش انبارگردانی</h2>
          <div id="reportSummary"></div>
          <div class="actions" style="margin-top:14px">
            <button class="btn btn-primary btn-block" id="btnCopyReport">📋 کپی خلاصه گزارش</button>
            <button class="btn btn-success btn-block" id="btnExportDiffs">📥 اکسل مغایرت‌ها</button>
            <button class="btn btn-secondary btn-block" id="btnExportBarcodeQuantity">📊 اکسل فقط بارکد و مقدار</button>
            <button class="btn btn-secondary btn-block" id="btnAccGeneric">📒 سند اصلاح (عمومی)</button>
            <button class="btn btn-secondary btn-block" id="btnAccHeloo">📒 قالب هلو</button>
            <button class="btn btn-secondary btn-block" id="btnAccSepidar">📒 قالب سپیدار</button>
            <details class="card" style="margin-top:10px;padding:12px">
              <summary style="cursor:pointer;font-weight:700">⚙️ تنظیم ستون‌های خروجی اکسل هلو و سپیدار</summary>
              <p class="hint" style="margin:8px 0">قالب هر نرم‌افزار جداگانه ذخیره می‌شود. خروجی شامل کالاهای شمارش‌شده است و ستون «موجودی شمارش‌شده» مقدار نهایی شمارش را نشان می‌دهد.</p>
              <label for="accountingTemplateTarget">قالب مقصد</label>
              <select id="accountingTemplateTarget" class="search-input" style="margin:6px 0 10px;width:100%">
                <option value="heloo">هلو</option><option value="sepidar">سپیدار</option>
              </select>
              <div id="accountingTemplateFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:2px"></div>
              <div class="actions" style="margin-top:10px">
                <button class="btn btn-secondary btn-block" id="btnSaveAccountingTemplate" type="button">💾 ذخیره قالب انتخابی</button>
                <button class="btn btn-primary btn-block" id="btnExportAccountingTemplate" type="button">📊 خروجی اکسل با ستون‌های انتخابی</button>
              </div>
            </details>
            <button class="btn btn-secondary btn-block" id="btnDoubleDiff">📥 اختلاف فاز ۱ و ۲</button>
            <button class="btn btn-secondary btn-block" id="btnStockAlerts">⚠️ هشدار موجودی</button>
            <button class="btn btn-secondary btn-block" id="btnPrintLabels">🏷️ چاپ لیبل بارکد (تا ۵۰)</button>
            <button class="btn btn-primary btn-block" id="btnApplySystem">✔ اعمال شمارش روی موجودی سیستم</button>
            <button class="btn btn-secondary btn-block" id="btnResetToSystem">شمارش = مقدار سیستم</button>
          </div>
        </div>
      </section>

      <section class="page" id="page-audit">
        <div class="card">
          <h2>لاگ عملیات</h2>
          <p class="hint">تاریخچه شمارش، ورود، ادغام، ویرایش کالا و …</p>
          <input type="search" id="auditSearch" placeholder="جستجو در لاگ..." class="search-input" style="margin-top:10px" />
          <div id="auditList" style="margin-top:10px"></div>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-audit-export btn-block" id="btnExportAudit" type="button">📄 دانلود CSV لاگ</button>
            <button class="btn btn-audit-clear btn-block" id="btnClearAudit" type="button">🗑 پاک کردن لاگ</button>
          </div>
        </div>
      </section>

      <section class="page" id="page-admin">
        <div class="card">
          <h2>وضعیت سیستم</h2>
          <ul class="info-list">
            <li>منبع داده: <code id="storageInfo">—</code></li>
            <li>انبار فعال: <code id="warehouseInfo">—</code></li>
            <li>نقش: <code id="roleInfo">—</code></li>
            <li>قابلیت اسکنر: <code id="capsInfo">—</code></li>
            <li>شمارش دوفازی: <code id="doubleInfo">—</code></li>
          </ul>
        </div>
        <div class="card" style="margin-top:12px">
          <h2>تنظیمات</h2>
          <div class="settings-grid">
            <label class="set-row"><span>اسکن پیوسته</span><input type="checkbox" id="setContinuous" /></label>
            <label class="set-row"><span>پرش خودکار بعد از اسکن</span><input type="checkbox" id="setAutoNext" /></label>
            <label class="set-row"><span>صدای اسکن</span><input type="checkbox" id="setSound" /></label>
            <label class="set-row"><span>ویبره</span><input type="checkbox" id="setVibrate" /></label>
            <label class="set-row"><span>افزایش خودکار (+۱)</span><input type="checkbox" id="setAutoInc" /></label>
            <label class="set-row"><span>شمارش کور (بدون نمایش مغایرت)</span><input type="checkbox" id="setBlind" /></label>
            <label class="set-row"><span>اسکنر USB/Bluetooth</span><input type="checkbox" id="setBt" /></label>
            <label class="set-row"><span>شمارش دوفازی</span><input type="checkbox" id="setDouble" /></label>
            <label class="set-row"><span>نقش</span>
              <select id="setRole">
                <option value="admin">مدیر</option>
                <option value="counter">شمارنده</option>
                <option value="viewer">مشاهده‌گر</option>
              </select>
            </label>
            <label class="set-row"><span>انبار فعال</span><input type="text" id="setWarehouse" /></label>
            <label class="set-row"><span>نام اپراتور</span><input type="text" id="setOperator" placeholder="نام شما" /></label>
          </div>
          <button class="btn btn-primary btn-block" id="btnSaveSettings" style="margin-top:12px">💾 ذخیره تنظیمات</button>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-secondary btn-block" id="btnClearCounts">پاک کردن همه شمارش‌ها</button>
            <button class="btn btn-secondary btn-block" id="btnZeroUncounted">صفر کردن شمارش‌نشده‌ها</button>
          </div>
        </div>

        <div class="card" style="margin-top:12px">
          <h2>لایسنس</h2>
          <p class="hint" id="licenseDetail">—</p>
          <label class="field" style="margin-top:8px;display:block">
            <span style="font-size:.82rem;font-weight:700;color:var(--text-soft)">شناسه دستگاه</span>
            <input id="deviceIdDisplay" readonly style="width:100%;margin-top:4px;direction:ltr;text-align:left;font-family:monospace;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
          </label>
          <label class="field" style="margin-top:8px;display:block">
            <span style="font-size:.82rem;font-weight:700;color:var(--text-soft)">کلید لایسنس</span>
            <input id="licenseKeyInput" placeholder="ANB3...." style="width:100%;margin-top:4px;direction:ltr;text-align:left;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
          </label>
          <div class="actions" style="margin-top:10px">
            <button class="btn btn-primary btn-block" id="btnActivateLicense">فعال‌سازی لایسنس</button>
            <button class="btn btn-secondary btn-block" id="btnDeactivateLicense">حذف لایسنس</button>
            <button class="btn btn-secondary btn-block" id="btnCopyDeviceId">کپی شناسه دستگاه</button>
          </div>
        </div>

        <div class="card" style="margin-top:12px">
          <h2>همگام‌سازی تیمی</h2>
          <p class="hint">روش را انتخاب کنید: آفلاین برای انتقال فایل بدون اینترنت، یا زنده برای تبادل خودکار شمارش از طریق اینترنت. اطلاعات کالاها و شمارش ابتدا روی همین دستگاه ذخیره می‌شود.</p>
          <label class="set-row" style="margin-top:10px"><span>روش همگام‌سازی</span><select id="teamSyncMode"><option value="offline">آفلاین — انتقال فایل</option><option value="live">زنده — اینترنت</option></select></label>
          <div id="teamLiveConfig" style="display:none;margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:10px">
            <p class="hint">برای حالت زنده، پروژه Supabase و جدول همگام‌سازی را طبق فایل LIVE_SYNC_SETUP_FA.md راه‌اندازی کنید. فقط کلید عمومی anon/publishable را وارد کنید؛ کلید secret را وارد نکنید.</p>
            <label class="field" style="display:block;margin-top:8px"><span>آدرس پروژه Supabase</span><input id="teamSupabaseUrl" type="url" placeholder="https://xxxx.supabase.co" style="width:100%;direction:ltr;text-align:left;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
            <label class="field" style="display:block;margin-top:8px"><span>کلید عمومی (anon / publishable)</span><input id="teamSupabaseKey" type="password" placeholder="کلید عمومی پروژه" autocomplete="off" style="width:100%;direction:ltr;text-align:left;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" /></label>
            <div class="actions" style="margin-top:8px"><button class="btn btn-secondary btn-block" id="btnSaveLiveConfig">ذخیره تنظیمات</button><button class="btn btn-primary btn-block" id="btnStartLiveSync">اتصال زنده</button><button class="btn btn-secondary btn-block" id="btnStopLiveSync">قطع اتصال زنده</button></div>
            <p class="hint" id="teamLiveStatus" role="status">همگام‌سازی زنده متوقف است</p>
          </div>
          <p class="hint" id="teamOfflineHint">حالت آفلاین: بسته JSON را صادر و در دستگاه دیگر وارد کنید. برای شمارش تکراری «بیشینه» و برای بخش‌های جداگانه «جمع» را انتخاب کنید.</p>
          <p class="hint" id="teamSyncInfo">—</p>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
            <input type="text" id="teamSessionCode" readonly style="flex:1;direction:ltr;text-align:left;font-family:monospace;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
            <button class="btn btn-sm btn-secondary" id="btnCopyTeamCode">کپی</button>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input type="text" id="joinSessionInput" placeholder="کد جلسه برای پیوستن" style="flex:1;direction:ltr;text-align:left;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
            <button class="btn btn-sm btn-primary" id="btnJoinSession">پیوستن</button>
          </div>
          <label class="set-row" style="margin-top:10px">
            <span>حالت ادغام تداخل</span>
            <select id="teamMergeMode">
              <option value="max">بیشینه (max) — پیش‌فرض امن‌تر برای شمارش تکراری</option>
              <option value="sum">جمع (sum) — فقط برای مقادیر جداگانه</option>
              <option value="incoming">فایل ورودی</option>
              <option value="local">مقدار محلی</option>
            </select>
          </label>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-primary btn-block" id="btnExportTeam">📤 ارسال بسته همگام‌سازی</button>
            <button class="btn btn-secondary btn-block" id="btnImportTeam">📥 دریافت و ادغام بسته</button>
            <input type="file" id="teamSyncFile" accept=".json" style="display:none" />
            <button class="btn btn-secondary btn-block" id="btnExportPartial">📤 خروجی شمارش این دستگاه</button>
            <button class="btn btn-secondary btn-block" id="btnExportMergeReport">📄 گزارش آخرین ادغام</button>
          </div>
        </div>

        <div class="card" style="margin-top:12px">
          <h2>ورود و خروجی</h2>
          <p class="hint">پشتیبانی از XLSX، CSV و JSON</p>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-primary btn-block" id="btnImport">📥 ورود از فایل</button>
            <input type="file" id="importFile" accept=".xlsx,.xls,.csv,.txt,.json" style="display:none" />
            <button class="btn btn-success btn-block" id="btnExportExcel">📥 دانلود اکسل کامل</button>
            <button class="btn btn-primary btn-block" id="btnExportDiff">📥 دانلود فقط مغایرت‌ها</button>
            <button class="btn btn-secondary btn-block" id="btnExportCsv">📄 دانلود CSV</button>
            <button class="btn btn-secondary btn-block" id="btnExportJson">💾 پشتیبان JSON</button>
            <button class="btn btn-secondary btn-block" id="btnExportPhotos">🖼 خروجی بسته عکس‌ها</button>
            <button class="btn btn-secondary btn-block" id="btnImportPhotos">📥 ورود بسته عکس‌ها</button>
            <input type="file" id="photoPackFile" accept=".json" style="display:none" />
          </div>
          <p class="hint" id="importStatus" style="margin-top:8px"></p>
          <p class="hint" id="photoCountInfo" style="margin-top:4px"></p>
        </div>
      </section>
    </main>

    <!-- Scanner Modal -->
    <div id="scannerModal" class="modal-overlay scanner-modal">
      <div class="modal-sheet">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <strong id="scannerTitle">اسکن بارکد</strong>
          <button class="btn btn-sm btn-secondary" id="btnCloseScanner">بستن</button>
        </div>
        <div id="scanner-container"></div>
        <div class="scanner-toolbar">
          <button class="btn btn-sm btn-secondary" id="torchBtn">🔦 نور</button>
          <button class="btn btn-sm btn-secondary" id="btnRestartCam">🔄 راه‌اندازی مجدد</button>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;margin-right:auto">
            <input type="checkbox" id="scannerContinuous" checked /> پیوسته
          </label>
        </div>
        <div class="manual-row">
          <input type="text" id="manualBarcode" placeholder="ورود دستی بارکد..." inputmode="text" autocomplete="off" />
          <button class="btn btn-primary btn-sm" id="btnManualSubmit">ثبت</button>
        </div>
      </div>
    </div>

    <!-- Qty Modal -->
    <div id="qtyModal" class="modal-overlay qty-modal">
      <div class="modal-card">
        <div id="qtyModalName" style="font-size:1.15rem;font-weight:800;color:var(--primary-deeper)"></div>
        <div id="qtyModalMeta" class="hint" style="margin-top:4px"></div>
        <div class="qty-controls">
          <button class="btn btn-secondary qty-step" id="qtyMinus" aria-label="کم کردن تعداد">−</button>
          <input type="number" id="qtyModalInput" min="0" step="any" inputmode="decimal" class="qty-input" />
          <button class="btn btn-secondary qty-step" id="qtyPlus" aria-label="زیاد کردن تعداد">+</button>
        </div>
        <div id="qtyModalDiff" style="text-align:center;font-size:.85rem;margin:10px 0;min-height:22px"></div>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button class="btn btn-sm btn-secondary" id="qtyModalEqBtn" style="flex:1">= سیستم</button>
          <button class="btn btn-sm btn-secondary" id="qtySet0" style="flex:1">۰</button>
          <button class="btn btn-sm btn-secondary" id="qtySet1" style="flex:1">۱</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" id="qtyCancel" style="flex:1">انصراف</button>
          <button class="btn btn-primary" id="qtyConfirm" style="flex:1.4">✓ تأیید</button>
        </div>
      </div>
    </div>

    <nav class="nav">
      <button class="nav-item active" data-page="count">شمارش</button>
      <button class="nav-item" data-page="products">کالاها</button>
      <button class="nav-item" data-page="reports">گزارش</button>
      <button class="nav-item" data-page="audit">لاگ</button>
      <button class="nav-item" data-page="admin">تنظیمات</button>
    </nav>
  `;

  bindEvents();
  setupVirtualLists();
}

function bindEvents() {
  // جلسه جدید و بستن جلسه قبلاً فقط در رابط کاربری نمایش داده می‌شدند؛
  // رویداد کلیک آن‌ها به عملیات واقعی متصل نبود.
  document.getElementById('btnStartSession')?.addEventListener('click', () => {
    try {
      if (!guardWrite('شروع جلسه جدید')) return;
      actionStartSession();
      updateHeader();
      refreshLists();
      updateUndoBtn();
    } catch (err) {
      console.error('[Anbarin] start session failed:', err);
      toast('شروع جلسه جدید انجام نشد؛ دوباره تلاش کنید', 'error');
    }
  });
  document.getElementById('btnCloseSession')?.addEventListener('click', () => {
    try {
      if (!guardWrite('بستن جلسه')) return;
      actionCloseSession();
      updateHeader();
      refreshLists();
      updateUndoBtn();
    } catch (err) {
      console.error('[Anbarin] close session failed:', err);
      toast('بستن جلسه انجام نشد؛ دوباره تلاش کنید', 'error');
    }
  });
  document.getElementById('btnSaveSettings')?.addEventListener('click', () => {
    try {
      applySettingsFromForm();
      // هم نشان نقش و هم محدودیت‌های UI را بلافاصله با نقش جدید هماهنگ کن.
      updateHeader();
      fillSettingsForm();
      refreshLists();
    } catch (err) {
      console.error('[Anbarin] saving settings failed:', err);
      toast('ذخیره تنظیمات انجام نشد؛ فضای ذخیره‌سازی را بررسی کنید', 'error');
    }
  });
  // دکمه‌های عملیات شمارش باید به توابع واقعی متصل باشند؛ قبلاً فقط در رابط نمایش داده می‌شدند.
  document.getElementById('btnClearCounts')?.addEventListener('click', () => {
    if (!guardWrite('پاک کردن شمارش‌ها')) return;
    actionClearCounts();
    updateHeader();
    refreshLists();
  });
  document.getElementById('btnZeroUncounted')?.addEventListener('click', () => {
    if (!guardWrite('صفر کردن شمارش‌نشده‌ها')) return;
    actionZeroUncounted();
    updateHeader();
    refreshLists();
  });

  // عملیات همگام‌سازی شمارش با موجودی سیستم؛ این دکمه‌ها قبلاً تابع داشتند
  // اما رویداد کلیک به آن‌ها متصل نشده بود.
  document.getElementById('btnApplySystem')?.addEventListener('click', () => {
    if (!guardWrite('اعمال شمارش روی موجودی سیستم')) return;
    try {
      if (applyCountsToSystem()) {
        updateHeader();
        refreshLists();
        updateUndoBtn();
      }
    } catch (err) {
      console.error('[Anbarin] apply counts to system failed:', err);
      toast('اعمال شمارش روی موجودی سیستم ناموفق بود؛ دوباره تلاش کنید', 'error');
    }
  });
  document.getElementById('btnResetToSystem')?.addEventListener('click', () => {
    if (!guardWrite('برگرداندن شمارش به مقدار سیستم')) return;
    try {
      if (resetCountsToSystem()) {
        updateHeader();
        refreshLists();
        updateUndoBtn();
      }
    } catch (err) {
      console.error('[Anbarin] reset counts to system failed:', err);
      toast('همسان‌سازی شمارش با موجودی سیستم ناموفق بود؛ دوباره تلاش کنید', 'error');
    }
  });

  // چاپ لیبل بارکد؛ دکمه قبلاً در رابط بود اما رویداد کلیک نداشت.
  document.getElementById('btnPrintLabels')?.addEventListener('click', () => {
    try {
      printLabelsBulk(50);
    } catch (err) {
      console.error('[Anbarin] print barcode labels failed:', err);
      toast('چاپ لیبل انجام نشد؛ مرورگر یا مجوز چاپ را بررسی کنید', 'error');
    }
  });

  // لاگ عملیات: دکمه‌ها قبلاً در صفحه وجود داشتند اما رویداد کلیک نداشتند.
  document.getElementById('btnExportAudit')?.addEventListener('click', () => {
    try {
      exportAuditCSV();
    } catch (err) {
      console.error('[Anbarin] export audit failed:', err);
      toast('دانلود لاگ ناموفق بود؛ دوباره تلاش کنید', 'error');
    }
  });
  document.getElementById('btnClearAudit')?.addEventListener('click', () => {
    try {
      clearAuditLog();
      renderAuditList();
    } catch (err) {
      console.error('[Anbarin] clear audit failed:', err);
      toast('پاک کردن لاگ ناموفق بود', 'error');
    }
  });
  document.getElementById('auditSearch')?.addEventListener('input', () => renderAuditList());

  document.getElementById('btnOpenScanner')?.addEventListener('click', () => {
    if (!guardWrite('اسکن')) return;
    const modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'flex';
    settings.quickAutoConfirm = false;
    openScanner({ title: 'اسکن بارکد' });
  });

  document.getElementById('btnQuickCount')?.addEventListener('click', () => {
    if (!guardWrite('شمارش سریع')) return;
    settings.quickAutoConfirm = true;
    const modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'flex';
    openScanner({ quick: true, title: 'شمارش سریع ⚡' });
  });

  document.getElementById('btnCloseScanner')?.addEventListener('click', () => {
    settings.quickAutoConfirm = false;
    closeScanner();
    const modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('torchBtn')?.addEventListener('click', () => toggleTorch());
  document.getElementById('btnRestartCam')?.addEventListener('click', () => restartCamera());
  document.getElementById('btnManualSubmit')?.addEventListener('click', () => submitManualBarcode());
  document.getElementById('manualBarcode')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManualBarcode();
    }
  });

  document.getElementById('qtyMinus')?.addEventListener('click', () => adjustQtyModal(-1));
  document.getElementById('qtyPlus')?.addEventListener('click', () => adjustQtyModal(1));
  document.getElementById('qtyModalEqBtn')?.addEventListener('click', () => setQtyModalToSystem());
  document.getElementById('qtySet0')?.addEventListener('click', () => {
    const inp = document.getElementById('qtyModalInput') as HTMLInputElement;
    if (inp) {
      inp.value = '0';
      updateQtyModalDiff();
    }
  });
  document.getElementById('qtySet1')?.addEventListener('click', () => {
    const inp = document.getElementById('qtyModalInput') as HTMLInputElement;
    if (inp) {
      inp.value = '1';
      updateQtyModalDiff();
    }
  });
  document.getElementById('qtyCancel')?.addEventListener('click', () => closeQtyModal());
  document.getElementById('qtyConfirm')?.addEventListener('click', () => {
    if (confirmQtyModal()) {
      updateHeader();
      refreshLists();
      const continuous =
        (document.getElementById('scannerContinuous') as HTMLInputElement)?.checked ??
        settings.continuousScan;
      if (!continuous) {
        closeScanner();
        const modal = document.getElementById('scannerModal');
        if (modal) modal.style.display = 'none';
      }
    }
  });
  document.getElementById('qtyModalInput')?.addEventListener('input', () => updateQtyModalDiff());
  document.getElementById('qtyModalInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('qtyConfirm')?.click();
    }
  });

  document.getElementById('undoBtn')?.addEventListener('click', () => {
    undoLast();
    updateUndoBtn();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      const tag = ((e.target as HTMLElement)?.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        undoLast();
        updateUndoBtn();
      }
    }
  });

  // Location filters
  const onLoc = (val: string) => {
    setLocationFilter(val);
    // sync both selects
    const a = document.getElementById('locationFilterSelect') as HTMLSelectElement | null;
    const b = document.getElementById('locationFilterSelectProducts') as HTMLSelectElement | null;
    if (a) a.value = val;
    if (b) b.value = val;
    refreshLists();
  };
  document.getElementById('locationFilterSelect')?.addEventListener('change', (e) => {
    onLoc((e.target as HTMLSelectElement).value);
  });
  document.getElementById('locationFilterSelectProducts')?.addEventListener('change', (e) => {
    onLoc((e.target as HTMLSelectElement).value);
  });

  // Search & filters
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const onSearch = (val: string) => {
    productSearchQuery = val;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshLists(), 180);
  };
  document.getElementById('searchProducts')?.addEventListener('input', (e) => {
    onSearch((e.target as HTMLInputElement).value);
  });
  document.getElementById('searchCount')?.addEventListener('input', (e) => {
    onSearch((e.target as HTMLInputElement).value);
  });
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      countFilter = ((chip as HTMLElement).dataset.cf as typeof countFilter) || 'all';
      refreshLists();
    });
  });

  // Products CRUD
  document.getElementById('btnAddProduct')?.addEventListener('click', () => {
    if (!guardWrite('افزودن کالا')) return;
    openProductModal();
  });
  setProductsChangeListener(() => {
    updateHeader();
    refreshLists();
  });

  // Team sync mode: offline file transfer or optional live Supabase sync
  fillLiveConfigForm();
  const syncModeEl = document.getElementById('teamSyncMode') as HTMLSelectElement | null;
  const liveConfigEl = document.getElementById('teamLiveConfig');
  const offlineHintEl = document.getElementById('teamOfflineHint');
  const updateSyncModeUI = () => {
    const live = getTeamSyncMode() === 'live';
    if (syncModeEl) syncModeEl.value = live ? 'live' : 'offline';
    if (liveConfigEl) liveConfigEl.style.display = live ? 'block' : 'none';
    if (offlineHintEl) offlineHintEl.style.display = live ? 'none' : 'block';
  };
  updateSyncModeUI();
  syncModeEl?.addEventListener('change', () => { setTeamSyncMode(syncModeEl.value === 'live' ? 'live' : 'offline'); updateSyncModeUI(); });
  document.getElementById('btnSaveLiveConfig')?.addEventListener('click', () => {
    const url = (document.getElementById('teamSupabaseUrl') as HTMLInputElement | null)?.value || '';
    const key = (document.getElementById('teamSupabaseKey') as HTMLInputElement | null)?.value || '';
    if (saveLiveConfig(url, key)) setTeamSyncMode('live');
    updateSyncModeUI();
  });
  document.getElementById('btnStartLiveSync')?.addEventListener('click', async () => {
    setTeamSyncMode('live'); updateSyncModeUI(); await startLiveSync();
  });
  document.getElementById('btnStopLiveSync')?.addEventListener('click', () => stopLiveSync());
  window.addEventListener('anbar-live-counts-updated', () => { updateHeader(); updateUndoBtn(); refreshLists(); });

  // Team sync
  document.getElementById('btnCopyTeamCode')?.addEventListener('click', () => copyTeamSessionCode());
  document.getElementById('btnJoinSession')?.addEventListener('click', () => {
    if (joinTeamSession()) {
      refreshTeamSyncUI();
      updateHeader();
    }
  });
  document.getElementById('btnExportTeam')?.addEventListener('click', () => {
    if (!requirePremium('همگام‌سازی تیمی')) return;
    exportTeamSyncPack();
  });
  document.getElementById('btnExportPartial')?.addEventListener('click', () => exportPartialCount());
  document.getElementById('btnExportMergeReport')?.addEventListener('click', () => exportTeamConflictReport());
  document.getElementById('btnImportTeam')?.addEventListener('click', () => {
    document.getElementById('teamSyncFile')?.click();
  });
  document.getElementById('teamSyncFile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    await importTeamSyncPack(f);
    (e.target as HTMLInputElement).value = '';
    updateHeader();
    refreshLists();
    refreshTeamSyncUI();
  });

  // Photos
  document.getElementById('btnTakePhoto')?.addEventListener('click', () => {
    captureProductPhoto();
  });
  document.getElementById('btnExportPhotos')?.addEventListener('click', () => exportPhotosPack());
  document.getElementById('btnImportPhotos')?.addEventListener('click', () => {
    document.getElementById('photoPackFile')?.click();
  });
  document.getElementById('photoPackFile')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    await importPhotosPack(f);
    (e.target as HTMLInputElement).value = '';
    updateHeader();
    refreshLists();
  });

  // Reports
  document.getElementById('btnCopyReport')?.addEventListener('click', () => copyTextReport());
  document.getElementById('btnExportDiffs')?.addEventListener('click', () => exportDiffsExcel());
  document.getElementById('btnExportBarcodeQuantity')?.addEventListener('click', () => exportBarcodeQuantityExcel());
  document.getElementById('btnAccGeneric')?.addEventListener('click', () => exportAccountingDoc('generic'));
  document.getElementById('btnAccHeloo')?.addEventListener('click', () => exportAccountingDoc('heloo'));
  document.getElementById('btnAccSepidar')?.addEventListener('click', () => exportAccountingDoc('sepidar'));
  initAccountingTemplateUI();
  document.getElementById('btnDoubleDiff')?.addEventListener('click', () => exportDoubleCountMismatches());
  document.getElementById('btnStockAlerts')?.addEventListener('click', () => exportStockAlerts());

  // Import / Export
  document.getElementById('btnImport')?.addEventListener('click', () => {
    document.getElementById('importFile')?.click();
  });
  document.getElementById('importFile')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const status = document.getElementById('importStatus');
    if (status) status.textContent = 'در حال پردازش...';
    await loadSheetJS();
    const result = await processImportFile(file);
    if (status) {
      status.textContent = result
        ? `انجام شد: ${result.added} جدید، ${result.updated} به‌روز`
        : 'لغو یا ناموفق';
    }
    input.value = '';
    updateHeader();
    refreshLists();
  });
  document.getElementById('btnExportExcel')?.addEventListener('click', async () => {
    if (!requirePremium('خروجی اکسل')) return;
    await loadSheetJS();
    exportExcel(false);
  });
  document.getElementById('btnExportDiff')?.addEventListener('click', async () => {
    if (!requirePremium('خروجی مغایرت')) return;
    await loadSheetJS();
    exportExcel(true);
  });
  document.getElementById('btnExportCsv')?.addEventListener('click', () => exportCSV(false));
  document.getElementById('btnExportJson')?.addEventListener('click', () => exportJSON());

  // دکمه‌های لایسنس و شناسه دستگاه نیز باید عملکرد واقعی داشته باشند.
  document.getElementById('btnActivateLicense')?.addEventListener('click', () => {
    try {
      if (activateLicenseFromInput()) updateHeader();
    } catch (err) {
      console.error('[Anbarin] license activation failed:', err);
      toast('فعال‌سازی لایسنس انجام نشد؛ کلید را بررسی کنید', 'error');
    }
  });
  document.getElementById('btnDeactivateLicense')?.addEventListener('click', () => {
    try {
      deactivateLicense();
      updateHeader();
    } catch (err) {
      console.error('[Anbarin] license deactivation failed:', err);
      toast('حذف لایسنس انجام نشد', 'error');
    }
  });
  document.getElementById('btnCopyDeviceId')?.addEventListener('click', async () => {
    const deviceId = getDeviceId();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deviceId);
      } else {
        const input = document.getElementById('deviceIdDisplay') as HTMLInputElement | null;
        input?.focus();
        input?.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
      }
      toast('شناسه دستگاه کپی شد', 'success');
    } catch (err) {
      console.error('[Anbarin] copy device ID failed:', err);
      toast('کپی خودکار ممکن نشد؛ شناسه را دستی انتخاب و کپی کنید', 'error');
    }
  });

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = (btn as HTMLElement).dataset.page;
      if (page) {
        showPage(page);
        requestAnimationFrame(() => {
          refreshLists();
          if (page === 'audit') renderAuditList();
        });
      }
    });
  });

  const cont = document.getElementById('scannerContinuous') as HTMLInputElement | null;
  if (cont) cont.checked = settings.continuousScan !== false;
}

function updateHeader() {
  const stats = getCountStats();
  const el = document.getElementById('headerStats');
  if (el) {
    el.innerHTML = `<span>${formatFaNumber(stats.counted)} / ${formatFaNumber(stats.total)}</span>`;
  }

  const box = document.getElementById('statsBox');
  if (box) {
    box.innerHTML = `
      <div class="stat-card"><div class="stat-value">${formatFaNumber(stats.total)}</div><div class="stat-label">کل کالا</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(stats.counted)}</div><div class="stat-label">شمارش‌شده</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(stats.diffs)}</div><div class="stat-label">مغایرت</div></div>
      <div class="stat-card"><div class="stat-value">${formatFaNumber(stats.withPhoto)}</div><div class="stat-label">با عکس</div></div>
    `;
  }

  const sh = document.getElementById('sessionHint');
  if (sh) sh.textContent = getSessionLabel();
  const sl = document.getElementById('sessionLabel');
  if (sl) sl.textContent = getSessionLabel();

  const phaseBar = document.getElementById('phaseBar');
  if (phaseBar) phaseBar.style.display = settings.doubleCount ? 'flex' : 'none';


  const si = document.getElementById('storageInfo');
  if (si) si.textContent = String(storageBackend);
  const wi = document.getElementById('warehouseInfo');
  if (wi) wi.textContent = settings.currentWarehouse || '—';
  const ri = document.getElementById('roleInfo');
  if (ri) ri.textContent = settings.role || '—';
  const di = document.getElementById('doubleInfo');
  if (di) di.textContent = settings.doubleCount ? 'فعال' : 'غیرفعال';

  const rs = document.getElementById('reportSummary');
  if (rs) rs.innerHTML = renderReportHTML();

  const pci = document.getElementById('photoCountInfo');
  if (pci) pci.textContent = 'عکس‌های ذخیره‌شده: ' + countPhotos();
  refreshTeamSyncUI();
  updateLicenseUI();
  applyRoleUI();
}

function updateUndoBtn() {
  const btn = document.getElementById('undoBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = !canUndo();
}

function updateCapsInfo() {
  const caps = getScannerCapabilities();
  const el = document.getElementById('capsInfo');
  if (!el) return;
  const parts = [
    caps.barcodeDetector ? 'BarcodeDetector' : null,
    caps.html5Qrcode ? 'Html5Qrcode' : null,
    caps.mediaDevices ? 'Camera' : null,
    'USB/BT',
  ].filter(Boolean);
  el.textContent = parts.join(' + ') || 'فقط دستی';
}

bootApp();
