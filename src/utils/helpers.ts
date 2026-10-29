/** ابزارهای عمومی */

import { Capacitor, registerPlugin } from '@capacitor/core';

interface SaveFilePluginResult {
  cancelled: boolean;
  uri?: string;
  filename?: string;
}
interface SaveFilePluginAPI {
  save(options: { filename: string; mimeType: string; data: string }): Promise<SaveFilePluginResult>;
}
const NativeSaveFile = registerPlugin<SaveFilePluginAPI>('SaveFile');


/** تبدیل ارقام فارسی و عربی به ارقام استاندارد برای بارکد و کد کالا */
export function normalizeDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
}

export function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dateStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function generateId(prefix = ''): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 7)
  );
}

export function formatFaNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('fa-IR');
}

export function formatAuditTime(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('fa-IR') +
      ' ' +
      d.toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  } catch {
    return iso;
  }
}

export function downloadFile(
  content: string | Blob,
  filename: string,
  mime = 'text/plain;charset=utf-8'
): void {
  const blob =
    typeof content === 'string' ? new Blob([content], { type: mime }) : content;

  // در اپ اندرویدی، پنجره رسمی «ذخیره در» سیستم‌عامل را باز کن؛
  // کاربر پوشه و نام فایل را خودش انتخاب می‌کند.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    void (async () => {
      try {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const result = await NativeSaveFile.save({
          filename,
          mimeType: blob.type || mime || 'application/octet-stream',
          data: btoa(binary),
        });
        if (result.cancelled) return;
        window.dispatchEvent(new CustomEvent('anbarin:file-saved', {
          detail: { filename: result.filename || filename, uri: result.uri || '' },
        }));
      } catch (error) {
        console.error('ذخیره فایل در اندروید ناموفق بود', error);
        window.dispatchEvent(new CustomEvent('anbarin:file-save-error', {
          detail: { filename, message: String(error) },
        }));
      }
    })();
    return;
  }

  // نسخه وب / مرورگر: رفتار دانلود معمول حفظ می‌شود.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
