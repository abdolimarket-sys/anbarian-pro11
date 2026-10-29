/* چاپ لیبل مستقل از باندل اصلی؛ برای نسخه‌هایی که فایل JS قدیمی داخل assets دارند. */
(() => {
  'use strict';
  const DB_NAME = 'anbarin_db';
  const STORE = 'kv';

  // Code 128B symbol patterns (index is the symbol value). The checksum/stop values are included.
  const CODE128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function readState() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('ذخیره‌سازی برنامه در دسترس نیست'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => reject(req.error || new Error('باز کردن اطلاعات ناموفق بود'));
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) { db.close(); reject(new Error('اطلاعات کالا پیدا نشد')); return; }
        const tx = db.transaction(STORE, 'readonly');
        const get = tx.objectStore(STORE).get('app_state');
        get.onsuccess = () => { const value = get.result; db.close(); resolve(value || null); };
        get.onerror = () => { const e = get.error; db.close(); reject(e || new Error('خواندن اطلاعات ناموفق بود')); };
      };
    });
  }
  function barcodeSvg(raw) {
    const text = String(raw || '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
    if (!text || /[^\x20-\x7e]/.test(text)) return '';
    const codes = [104]; let checksum = 104;
    for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i) - 32; codes.push(n); checksum += n * (i + 1); }
    codes.push(checksum % 103, 106);
    let x = 10, rects = '';
    for (const code of codes) {
      const pattern = CODE128[code];
      if (!pattern) continue;
      for (let i = 0; i < pattern.length; i++) {
        const width = Number(pattern[i]) * 1.5;
        if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${width}" height="42"/>`;
        x += width;
      }
    }
    const width = x + 10;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="58" viewBox="0 0 ${width} 58"><rect width="100%" height="100%" fill="white"/><g fill="black">${rects}</g><text x="${width/2}" y="55" font-family="monospace" font-size="10" text-anchor="middle">${esc(text)}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function toast(message, error = false) {
    let el = document.getElementById('label-print-fallback-toast');
    if (!el) { el = document.createElement('div'); el.id = 'label-print-fallback-toast'; el.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;left:12px;right:12px;padding:12px 16px;border-radius:10px;background:#111827;color:white;font:14px Arial,sans-serif;text-align:center;box-shadow:0 4px 18px #0004'; document.body.appendChild(el); }
    el.style.background = error ? '#991b1b' : '#065f46'; el.textContent = message; el.hidden = false;
    clearTimeout(el._hideTimer); el._hideTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
  function makeHtml(list) {
    const cards = list.map(p => {
      const code = String(p.code || p.sku || '').trim();
      const bc = barcodeSvg(code);
      return `<div class="label-card">${bc ? `<img src="${bc}" alt="${esc(code)}">` : '<div class="no-bc">بارکد نامعتبر</div>'}<div class="label-name">${esc(p.name || 'بدون نام')}</div><div class="label-code">${esc(code)}</div>${p.location ? `<div class="label-loc">${esc(p.location)}</div>` : ''}</div>`;
    }).join('');
    return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>چاپ لیبل انبارین</title><style>@page{size:auto;margin:6mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:black;font-family:Arial,sans-serif}.label-card{display:inline-block;vertical-align:top;break-inside:avoid;page-break-inside:avoid;border:1px dashed #777;padding:7px;margin:4px;text-align:center;width:220px;background:white;color:black}.label-card img{display:block;max-width:100%;height:auto;min-height:45px;margin:0 auto}.label-name{font-weight:bold;font-size:13px;margin-top:5px}.label-code{font-family:monospace;font-size:12px;direction:ltr}.label-loc{font-size:11px;margin-top:2px}.no-bc{font-size:11px;padding:10px}</style></head><body>${cards}</body></html>`;
  }
  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
  }
  async function handlePrint() {
    try {
      toast('در حال آماده‌سازی لیبل‌ها…');
      let state = await withTimeout(readState(), 6000, 'خواندن اطلاعات کالا بیش از حد طول کشید؛ برنامه را ببندید و دوباره باز کنید.');
      if (!state || !Array.isArray(state.products)) {
        try { const oldProducts = JSON.parse(localStorage.getItem('anbar_products') || 'null'); if (Array.isArray(oldProducts)) state = { products: oldProducts, settings: JSON.parse(localStorage.getItem('anbar_settings') || '{}') }; } catch (_) {}
      }
      if (!state || !Array.isArray(state.products)) throw new Error('فهرست کالاها در حافظه پیدا نشد؛ یک‌بار برنامه را باز و ذخیره کنید.');
      const settings = state.settings || {};
      const warehouse = settings.currentWarehouse || 'انبار اصلی';
      let list = state.products.filter(p => String(p.code || p.sku || '').trim());
      if (warehouse && warehouse !== 'همه') list = list.filter(p => (p.warehouse || 'انبار اصلی') === warehouse);
      list = list.slice(0, 50);
      if (!list.length) throw new Error('در انبار فعال کالایی با کد/بارکد ثبت‌شده پیدا نشد.');
      const html = makeHtml(list);
      const nativePrint = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePrint;
      if (nativePrint && typeof nativePrint.printLabels === 'function') {
        const result = await withTimeout(nativePrint.printLabels({ html }), 10000, 'سیستم چاپ اندروید پاسخ نداد؛ APK جدید را نصب و دوباره امتحان کنید.');
        if (result && result.started) toast(`درخواست چاپ ${list.length} لیبل به اندروید ارسال شد.`);
        else toast('سیستم چاپ پاسخ تأیید نداد؛ نسخه APK را به‌روز کنید.', true);
        return;
      }
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
        throw new Error('این نسخه APK به ماژول چاپ اندروید متصل نیست. سورس را Sync کرده و APK جدید بسازید.');
      }
      const frame = document.createElement('iframe');
      frame.title = 'چاپ لیبل'; frame.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:.01;pointer-events:none';
      let fired = false;
      frame.onload = () => { if (fired) return; fired = true; const w = frame.contentWindow; if (!w) { frame.remove(); throw new Error('پنجره چاپ باز نشد'); } w.onafterprint = () => setTimeout(() => frame.remove(), 500); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { toast('مرورگر امکان چاپ را نداد.', true); frame.remove(); } }, 200); setTimeout(() => frame.remove(), 30000); };
      frame.srcdoc = html; document.body.appendChild(frame);
      toast(`آماده‌سازی ${list.length} لیبل انجام شد؛ پنجره چاپ باید باز شود.`);
    } catch (e) {
      console.error('[Anbarin label print fallback]', e);
      toast(e && e.message ? e.message : 'چاپ لیبل ناموفق بود.', true);
    }
  }
  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('#btnPrintLabels') : null;
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    void handlePrint();
  }, true);
})();
