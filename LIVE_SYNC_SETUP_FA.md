# راه‌اندازی همگام‌سازی زنده و آفلاین انبارین پرو

## انتخاب روش در برنامه
- **آفلاین — انتقال فایل:** هیچ سرور یا اینترنتی لازم نیست؛ از «ارسال بسته همگام‌سازی» و سپس «دریافت و ادغام بسته» استفاده کنید.
- **زنده — اینترنت:** شمارش‌ها به جدول Supabase ارسال و هر ۳٫۵ ثانیه تغییرات دستگاه‌های دیگر بررسی می‌شود. دستگاه‌ها باید اینترنت و کد جلسه یکسان داشته باشند.
- داده‌ها هنگام قطع اینترنت همچنان روی دستگاه ذخیره می‌شوند؛ این نسخه برای ارسال تغییرات معوقه به‌صورت صف مطمئنِ تراکنشی طراحی نشده است، بنابراین پس از قطعی طولانی، شمارش‌ها را بازبینی کنید.

## ساخت جدول برای آزمون
در Supabase > SQL Editor اجرا کنید:

```sql
create table if not exists public.anbar_live_counts (
  session_id text not null,
  product_key text not null,
  device_id text not null,
  code text not null default '',
  sku text not null default '',
  name text not null default '',
  counted_qty double precision null,
  counted_qty2 double precision null,
  updated_at timestamptz not null default now(),
  operator_name text not null default '',
  warehouse text not null default '',
  primary key (session_id, product_key, device_id)
);

alter table public.anbar_live_counts enable row level security;

-- فقط برای تست با دادهٔ ساختگی و غیرحساس:
create policy "demo read counts" on public.anbar_live_counts
  for select to anon using (true);
create policy "demo insert counts" on public.anbar_live_counts
  for insert to anon with check (true);
create policy "demo update counts" on public.anbar_live_counts
  for update to anon using (true) with check (true);
```

## مجوزهای دسترسی — مهم
این کد سمت کاربر از کلید عمومی Supabase استفاده می‌کند. برای اینکه بدون حساب کاربری کار کند، باید دسترسی anon به جدول تعریف شود؛ **سیاست عمومی برای خواندن/نوشتن داده‌های شمارش ناامن است** و هر کسی که آدرس و کلید عمومی پروژه را داشته باشد ممکن است به داده‌ها دسترسی پیدا کند. بنابراین برای استفادهٔ واقعی فروشگاهی، این جدول را با دادهٔ واقعی و سیاست عمومی باز نکنید. ابتدا احراز هویت کاربران و RLS محدود به اعضای تیم یا یک Edge Function امن پیاده‌سازی شود. در نسخه فعلی فقط اتصال آزمایشی با داده غیرحساس توصیه می‌شود.

پس از ساخت جدول، آدرس پروژه و کلید عمومی `anon` یا `publishable` را در برنامه وارد کنید. هرگز کلید `service_role` یا `sb_secret` را در برنامه قرار ندهید.

## نکات ادغام
- برای جلوگیری از دوباره‌شماری یک کالا که توسط چند دستگاه دیده شده، همگام‌سازی زنده مقدار شمارش دستگاه دیگر را بر اساس زمان آخرین تغییر اعمال می‌کند؛ مقادیر شمارش جداگانه/تقسیم‌شده را فقط زمانی استفاده کنید که روش کار تیم روشن باشد.
- در این نسخه تطبیق کالا با بارکد، سپس SKU و در نهایت نام انجام می‌شود. نام کالا به‌تنهایی شناسهٔ یکتای مطمئنی نیست.
- همگام‌سازی زنده هنوز جایگزین پشتیبان‌گیری نیست. قبل از شروع شمارش مهم، از داده‌ها خروجی بگیرید.
