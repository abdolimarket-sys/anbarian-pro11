# انبارین (Anbarin) — فاز ۱: معماری ماژولار

نسخه بازسازی‌شده با **Vite + TypeScript**.

## وضعیت فعلی (فاز ۱)

### انجام‌شده
- [x] اسکلت پروژه Vite + TypeScript
- [x] تعریف Typeهای اصلی (`Product`, `Settings`, `Session`, ...)
- [x] ماژول `storage` (IndexedDB + مهاجرت از localStorage)
- [x] ماژول `state` (single source of truth + index + undo + audit)
- [x] ماژول `ui` پایه (toast + page navigation + theme)
- [x] **ماژول `scanner`** (BarcodeDetector + Html5Qrcode + USB/BT + دستی)
- [x] **ماژول `count`** (شمارش، undo، double-count، مودال تعداد)
- [x] **ماژول `import-export`** (CSV / XLSX / JSON + نگاشت فارسی)
- [x] **Virtual List** برای لیست کالاها و شمارش
- [x] **جلسه + تنظیمات** (شروع/بستن جلسه، نقش، دوفازی، …)
- [x] **Service Worker** آفلاین
- [x] **گزارش‌ها** (خلاصه، سند اصلاح، هلو/سپیدار، هشدار موجودی)
- [x] **عکس کالا** (گرفتن، فشرده‌سازی، بسته عکس)
- [x] **همگام‌سازی تیمی** (فایل JSON، کد جلسه، ادغام)
- [x] **مدیریت کالا** (افزودن / ویرایش / حذف — بدون عقبگرد)
- [x] **لاگ عملیات (Audit UI)**
- [x] **چاپ لیبل Code128 + اعمال شمارش روی سیستم**
- [x] **لایسنس** (آزمایشی ۱۴روزه + ANB3 سازگار با قدیم)
- [x] **فیلتر محل + نقش یکدست در کل UI** (رفع عقبگرد)
- [x] نقطه ورود `main.ts` و CSS تمیز
- [x] حفظ سازگاری با داده‌های نسخه قبلی

### در صف بعدی
- [ ] بیلد روی دستگاه خودتان (`npm install && npm run dev`)
- [ ] بسته‌بندی APK
- [ ] polish نهایی UX

## ساختار پروژه

```
anbarin-app/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/                 # آیکون‌ها و manifest
└── src/
    ├── main.ts             # نقطه ورود
    ├── styles/main.css
    ├── types/index.ts      # مدل‌های داده
    ├── utils/helpers.ts
    └── modules/
        ├── storage.ts      # IndexedDB + localStorage
        ├── state.ts        # state مرکزی
        ├── ui.ts           # toast و navigation
        ├── scanner.ts      # دوربین + بارکد + USB/BT
        ├── count.ts         # شمارش + undo + double-count
        ├── import-export.ts  # CSV / XLSX / JSON
        ├── virtual-list.ts   # رندر مجازی لیست‌ها
        └── session-settings.ts # جلسه و تنظیمات
        └── reports.ts         # گزارش و سند اصلاح
        └── photos.ts          # عکس کالا
        └── team-sync.ts       # همگام‌سازی تیمی
        └── products-ui.ts     # فرم کالا
        └── audit-ui.ts        # لاگ عملیات
        └── labels.ts          # لیبل بارکد و عملیات دسته‌ای
        └── license.ts         # لایسنس و دوره آزمایشی
        └── filters-roles.ts   # فیلتر محل و نقش
```

## اجرای توسعه

```bash
cd anbarin-app
npm install
npm run dev
```

## بیلد برای تولید

```bash
npm run build
# خروجی در dist/
```

## نکات مهم مهاجرت

- داده‌های قبلی کاربر از `localStorage` (`anbar_products`) به‌صورت خودکار به IndexedDB منتقل می‌شوند.
- کلیدهای ذخیره‌سازی با نسخه قدیم سازگار نگه داشته شده‌اند.
- هدف این فاز **پایدار کردن معماری** است، نه افزودن قابلیت جدید.

## نسخه

- نسخه فعلی هدف: **1.4.0**
- نسخه قبلی داخل APK: **1.3.0**
