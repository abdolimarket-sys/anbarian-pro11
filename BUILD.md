# راهنمای بیلد انبارین

## پیش‌نیاز
- Node.js 18+ (پیشنهادی 20 LTS)
- npm

## نصب

```bash
cd anbarin-app
npm install
```

اگر registry داخلی خطا داد:

```bash
npm install --registry https://registry.npmjs.org/
```

## بررسی TypeScript

```bash
npm run typecheck
```

باید بدون خطا تمام شود.

## توسعه

```bash
npm run dev
```

آدرس پیش‌فرض: http://localhost:5173

## بیلد تولید

```bash
npm run build
```

خروجی در `dist/`:

- `index.html`
- `assets/*.js` / `*.css`
- فایل‌های `public/` (sw.js، آیکون، xlsx، …)

## پیش‌نمایش بیلد

```bash
npm run preview
```

## وضعیت تأییدشده

آخرین بررسی مهندسی:

- `tsc --noEmit` → موفق
- `vite build` → موفق (~93 KB JS gzip ~28 KB)

## نکات

- `base: './'` برای کار داخل WebView / فایل نسبی
- Service Worker فقط روی HTTPS یا localhost
- SheetJS اختیاری از `public/xlsx.full.min.js`
