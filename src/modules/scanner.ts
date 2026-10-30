/**
 * ماژول اسکنر بارکد
 * - BarcodeDetector بومی (اولویت)
 * - Fallback به Html5Qrcode (اگر لود شده باشد)
 * - پشتیبانی اسکنر USB/Bluetooth (keyboard wedge)
 * - ورود دستی
 */

import type { AppSettings } from '@/types';
import { toast } from './ui';
import { normalizeDigits } from '@/utils/helpers';

export type ScanSource = 'camera' | 'native' | 'html5' | 'bt' | 'manual';

export interface ScanResult {
  code: string;
  source: ScanSource;
  at: number;
}

export interface ScannerOptions {
  /** کانتینر DOM برای ویدیو (مثلاً #scanner-container) */
  containerId: string;
  /** تنظیمات برنامه */
  getSettings: () => AppSettings;
  /** آیا الان اجازه شمارش/اسکن وجود دارد؟ */
  canScan?: () => boolean;
  /** آیا مودال تأیید تعداد باز است؟ */
  isQtyModalOpen?: () => boolean;
  /** callback اصلی وقتی بارکد معتبر شناسایی شد */
  onScan: (result: ScanResult) => void;
  /** برای پر کردن فیلد خاص (مثلاً فرم کالا) */
  onFieldFill?: (fieldId: string, code: string) => void;
}

// ——— وضعیت داخلی ———
let opts: ScannerOptions | null = null;
let active = false;
let quickMode = false;
let scanTargetField: string | null = null;

// Native scanner
let nativeStream: MediaStream | null = null;
let nativeVideo: HTMLVideoElement | null = null;
let nativeDetector: { detect: (source: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement) => Promise<Array<{ rawValue: string }>> } | null = null;
let nativeRaf = 0;
let nativeBusy = false;
let nativeCanvas: HTMLCanvasElement | null = null;
let nativeCtx: CanvasRenderingContext2D | null = null;
let frameSkip = 0;
let torchOn = false;

// Html5Qrcode fallback (any برای جلوگیری از وابستگی سخت)
let html5Instance: any = null;

// Serialize camera start/stop operations. WebView camera engines are async and
// must not be started again while a previous instance is still stopping.
let cameraLifecycle: Promise<void> = Promise.resolve();
let cameraRequestId = 0;

// Debounce / guard
let lastScanTime = 0;
let lastScanCode = '';
const SCAN_COOLDOWN_MS = 250;
const SAME_CODE_COOLDOWN_MS = 900;

// Bluetooth / keyboard wedge
let btBuffer = '';
let btTimer: ReturnType<typeof setTimeout> | null = null;
let btListenerAttached = false;

// Audio
let audioCtx: AudioContext | null = null;

// ——— Public API ———

export function initScanner(options: ScannerOptions): void {
  opts = options;
  attachBluetoothListener();
}

export function isScannerActive(): boolean {
  return active;
}

export function openScanner(options?: {
  targetField?: string | null;
  quick?: boolean;
  title?: string;
}): void {
  if (!opts) {
    console.warn('[scanner] not initialized');
    return;
  }
  scanTargetField = options?.targetField ?? null;
  quickMode = !!options?.quick;
  active = true;
  const requestId = ++cameraRequestId;

  // UI title اگر وجود داشته باشد
  const titleEl = document.getElementById('scannerTitle');
  if (titleEl && options?.title) titleEl.textContent = options.title;

  const modal = document.getElementById('scannerModal');
  if (modal) modal.classList.add('show');

  cameraLifecycle = cameraLifecycle
    .then(async () => {
      if (!active || requestId !== cameraRequestId) return;
      // Ensure a previous camera session is fully released before reopening.
      await stopCamera();
      if (!active || requestId !== cameraRequestId) return;
      await startCamera(requestId);
    })
    .catch((err) => console.error('[scanner] open lifecycle failed', err));
}

export function closeScanner(): void {
  active = false;
  ++cameraRequestId;
  scanTargetField = null;
  quickMode = false;

  const modal = document.getElementById('scannerModal');
  if (modal) modal.classList.remove('show');

  cameraLifecycle = cameraLifecycle
    .then(() => stopCamera())
    .catch((err) => console.error('[scanner] close lifecycle failed', err));
}

export function submitManualBarcode(raw?: string): void {
  const input = document.getElementById('manualBarcode') as HTMLInputElement | null;
  const code = normalizeDigits(raw ?? input?.value ?? '');
  if (!code) {
    toast('بارکد را وارد کنید', 'error');
    return;
  }
  if (input) input.value = '';
  emitScan(code, 'manual');
}

export async function toggleTorch(): Promise<void> {
  if (!nativeStream) {
    toast('نور فقط در حالت دوربین بومی در دسترس است', 'info');
    return;
  }
  try {
    const track = nativeStream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() as any;
    if (!caps?.torch) {
      toast('این دوربین از نور پشتیبانی نمی‌کند', 'error');
      return;
    }
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] as any });
    const btn = document.getElementById('torchBtn');
    if (btn) btn.textContent = torchOn ? '🔦 خاموش' : '🔦 نور';
  } catch (e) {
    console.warn('torch failed', e);
    toast('تغییر نور ممکن نشد', 'error');
  }
}

export function restartCamera(): void {
  if (!active) return;
  const requestId = ++cameraRequestId;
  cameraLifecycle = cameraLifecycle
    .then(async () => {
      await stopCamera();
      if (active && requestId === cameraRequestId) await startCamera(requestId);
    })
    .catch((err) => console.error('[scanner] restart lifecycle failed', err));
}

export function playBeep(ok: boolean): void {
  const settings = opts?.getSettings();
  if (!settings?.soundOnScan) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.frequency.value = ok ? 880 : 200;
    g.gain.value = 0.15;
    o.start();
    setTimeout(() => o.stop(), ok ? 80 : 150);
  } catch {
    // ignore
  }
}

export function vibrateOnFail(): void {
  const settings = opts?.getSettings();
  if (settings?.vibrateOnScan && navigator.vibrate) {
    navigator.vibrate([50, 30, 50]);
  }
}

/** برای استفاده از بیرون وقتی می‌خواهیم guard اسکن تکراری را ریست کنیم */
export function markConfirmed(code: string): void {
  lastScanCode = code;
  lastScanTime = Date.now();
}

// ——— Internal ———

function shouldAcceptScan(code: string): boolean {
  const now = Date.now();
  if (now - lastScanTime < SCAN_COOLDOWN_MS) return false;
  if (code === lastScanCode && now - lastScanTime < SAME_CODE_COOLDOWN_MS) return false;
  return true;
}

function emitScan(code: string, source: ScanSource): void {
  code = normalizeDigits(code);
  if (!code || !opts) return;

  if (opts.canScan && !opts.canScan()) {
    toast('نقش مشاهده‌گر اجازه شمارش ندارد', 'error');
    return;
  }
  if (opts.isQtyModalOpen?.()) return;
  if (!shouldAcceptScan(code) && code === lastScanCode) return;

  lastScanTime = Date.now();
  lastScanCode = code;

  // حالت پر کردن فیلد
  if (scanTargetField) {
    playBeep(true);
    opts.onFieldFill?.(scanTargetField, code);
    toast('بارکد ثبت شد', 'success');
    // در حالت فیلد معمولاً اسکنر را می‌بندیم مگر continuous
    const continuous =
      (document.getElementById('scannerContinuous') as HTMLInputElement)?.checked ??
      opts.getSettings().continuousScan;
    if (!continuous) closeScanner();
    return;
  }

  opts.onScan({ code, source, at: lastScanTime });
}

function ensureMediaDevices(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as any;
  if (!nav.mediaDevices) nav.mediaDevices = {};
  if (!nav.mediaDevices.getUserMedia) {
    const legacy =
      nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia || nav.msGetUserMedia;
    if (legacy) {
      nav.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) =>
        new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
    }
  }
  return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia);
}

function cameraDiagMessage(): string {
  const secure =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.protocol === 'capacitor:' ||
      location.protocol === 'https:');
  if (!secure) {
    return 'محیط امن نیست (https لازم است). در APK باید از WebView امن Capacitor استفاده شود.';
  }
  if (!ensureMediaDevices()) {
    return 'دسترسی به دوربین در این WebView موجود نیست. مجوز CAMERA را در تنظیمات اپ فعال کنید.';
  }
  return '';
}

function isCurrentCameraRequest(requestId: number): boolean {
  return active && requestId === cameraRequestId;
}

async function startCamera(requestId: number): Promise<void> {
  if (!isCurrentCameraRequest(requestId) || !opts) return;
  torchOn = false;
  const btn = document.getElementById('torchBtn');
  if (btn) btn.textContent = '🔦 نور';

  const diag = cameraDiagMessage();
  if (diag) {
    toast(diag, 'error');
    document.getElementById('manualBarcode')?.focus();
    return;
  }

  // درخواست اولیه مجوز (بعضی WebViewها تا قبل از grant، API را خالی می‌دهند)
  try {
    const warm = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    warm.getTracks().forEach((tr) => tr.stop());
    if (!isCurrentCameraRequest(requestId)) return;
  } catch (err: any) {
    if (!isCurrentCameraRequest(requestId)) return;
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      toast('مجوز دوربین داده نشده — از تنظیمات گوشی برای این اپ، دوربین را فعال کنید', 'error');
    } else if (name === 'NotFoundError') {
      toast('دوربینی روی این دستگاه پیدا نشد', 'error');
    } else {
      toast('خطا در دسترسی دوربین: ' + (err?.message || name || 'نامشخص'), 'error');
    }
    document.getElementById('manualBarcode')?.focus();
    return;
  }

// اولویت اول: Html5Qrcode
if (typeof (window as any).Html5Qrcode !== 'undefined') {
  const html5Ok = await tryStartHtml5(requestId);
  if (html5Ok) return;
}
if (!isCurrentCameraRequest(requestId)) return;

// اولویت دوم: BarcodeDetector
const nativeOk = await tryStartNative(requestId);
if (nativeOk) return;
if (!isCurrentCameraRequest(requestId)) return;

  toast(
    'موتور اسکن بارکد لود نشده. از بارکدخوان USB/Bluetooth یا ورود دستی استفاده کنید',
    'error'
  );
  document.getElementById('manualBarcode')?.focus();
}

async function tryStartNative(requestId: number): Promise<boolean> {
  if (!isCurrentCameraRequest(requestId)) return false;
  if (
    !('mediaDevices' in navigator) ||
    !navigator.mediaDevices.getUserMedia ||
    !('BarcodeDetector' in window)
  ) {
    return false;
  }

  const host = document.getElementById(opts!.containerId);
  if (!host) return false;

  try {
    const supported = await (window as any).BarcodeDetector.getSupportedFormats();
    const preferred = [
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'code_128',
      'code_39',
      'itf',
      'qr_code',
      'codabar',
    ];
    const formats = preferred.filter((f) => supported.includes(f));
    if (!formats.length) return false;

    nativeDetector = new (window as any).BarcodeDetector({ formats });

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText =
      'width:100%;height:100%;display:block;object-fit:cover;background:#0b1f1c';

    host.innerHTML = '';
    host.appendChild(video);

    // راهنمای اسکن
    const guide = document.createElement('div');
    guide.className = 'scan-guide';
    guide.innerHTML =
      '<div class="scan-guide-frame"></div><div class="scan-guide-label">بارکد را داخل نوار افقی بگیرید</div>';
    host.appendChild(guide);

    nativeVideo = video;

    const constraintsList: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true },
    ];

    let stream: MediaStream | null = null;
    let lastErr: unknown = null;
    for (const c of constraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!stream) throw lastErr || new Error('camera');

    if (!isCurrentCameraRequest(requestId)) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }

    nativeStream = stream;
    video.srcObject = stream;
    await video.play();

    // فوکوس پیوسته
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() as any;
      if (caps?.focusMode?.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any });
      }
    } catch {
      // ignore
    }

    nativeCanvas = document.createElement('canvas');
    nativeCtx = nativeCanvas.getContext('2d', { willReadFrequently: true });
    frameSkip = 0;
    nativeBusy = false;

    const loop = async () => {
      if (!nativeVideo || !nativeStream || !isCurrentCameraRequest(requestId)) return;
      nativeRaf = requestAnimationFrame(loop);

      frameSkip++;
      if (frameSkip % 2) return; // هر ۲ فریم یک‌بار
      if (nativeBusy || video.readyState < 2) return;
      if (opts?.isQtyModalOpen?.()) return;

      nativeBusy = true;
      try {
        let source: HTMLVideoElement | HTMLCanvasElement = video;

        // برش نوار میانی برای تمرکز روی بارکد خطی
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (vw > 0 && vh > 0 && nativeCtx && nativeCanvas) {
            const cropH = Math.max(120, Math.floor(vh * 0.55));
            const cropY = Math.floor((vh - cropH) / 2);
            const targetW = Math.min(960, vw);
            const scale = targetW / vw;
            const targetH = Math.floor(cropH * scale);
            if (nativeCanvas.width !== targetW) nativeCanvas.width = targetW;
            if (nativeCanvas.height !== targetH) nativeCanvas.height = targetH;
            nativeCtx.drawImage(video, 0, cropY, vw, cropH, 0, 0, targetW, targetH);
            source = nativeCanvas;
          }
        } catch {
          source = video;
        }

        const found = await nativeDetector!.detect(source);
        if (found?.length) {
          const code = String(found[0].rawValue || '').trim();
          if (code && shouldAcceptScan(code)) {
            emitScan(code, 'native');
          }
        }
      } catch {
        // ignore frame errors
      } finally {
        nativeBusy = false;
      }
    };

    nativeRaf = requestAnimationFrame(loop);
    return true;
  } catch (err) {
    console.error('[scanner] native failed', err);
    stopNative();
    return false;
  }
}

async function tryStartHtml5(requestId: number): Promise<boolean>{
  const Html5Qrcode = (window as any).Html5Qrcode;
  if (!Html5Qrcode || !opts || !isCurrentCameraRequest(requestId)) return false;

  try {
    if (html5Instance) await stopHtml5();
    if (!isCurrentCameraRequest(requestId)) return false;
    html5Instance = new Html5Qrcode(opts.containerId);

    const formats = (window as any).Html5QrcodeSupportedFormats
      ? [
          (window as any).Html5QrcodeSupportedFormats.EAN_13,
          (window as any).Html5QrcodeSupportedFormats.EAN_8,
          (window as any).Html5QrcodeSupportedFormats.UPC_A,
          (window as any).Html5QrcodeSupportedFormats.UPC_E,
          (window as any).Html5QrcodeSupportedFormats.CODE_128,
          (window as any).Html5QrcodeSupportedFormats.CODE_39,
          (window as any).Html5QrcodeSupportedFormats.ITF,
          (window as any).Html5QrcodeSupportedFormats.QR_CODE,
        ]
      : undefined;

    await html5Instance.start(
      { facingMode: 'environment' },
      {
  fps: 15,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    return {
      width: Math.floor(viewfinderWidth * 0.85),
      height: Math.floor(viewfinderHeight * 0.55),
    };
  },
  formatsToSupport: formats,
      },
      (decoded: string) => {
        if (isCurrentCameraRequest(requestId) && shouldAcceptScan(decoded)) emitScan(decoded, 'html5');
      },
      () => {}
    );
	return isCurrentCameraRequest(requestId);
  } catch (err: any) {
    console.error('[scanner] html5 failed', err);
    await stopHtml5();
	// Do not show a failure toast here: BarcodeDetector is tried next.
	return false;
  }
  
}

function stopNative(): void {
  if (nativeRaf) {
    cancelAnimationFrame(nativeRaf);
    nativeRaf = 0;
  }
  if (nativeStream) {
    nativeStream.getTracks().forEach((t) => t.stop());
    nativeStream = null;
  }
  nativeVideo = null;
  nativeDetector = null;
  nativeCanvas = null;
  nativeCtx = null;
  nativeBusy = false;
  torchOn = false;
}

async function stopHtml5(): Promise<void> {
  if (html5Instance) {
    const instance = html5Instance;
    try {
      if (instance.isScanning) await instance.stop();
    } catch {
      // ignore
    }
    try {
      if (typeof instance.clear === 'function') await instance.clear();
    } catch {
      // clear may fail if the library already removed its DOM; the next
      // instance is still created fresh below.
    }
    if (html5Instance === instance) html5Instance = null;
  }
}

async function stopCamera(): Promise<void> {
  stopNative();
  await stopHtml5();

  const host = opts ? document.getElementById(opts.containerId) : null;
  if (host) host.innerHTML = '';
}

// ——— Bluetooth / USB keyboard wedge ———

function attachBluetoothListener(): void {
  if (btListenerAttached) return;
  btListenerAttached = true;

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!opts) return;
    const settings = opts.getSettings();
    if (settings.btScanner === false) return;

    const tag = ((e.target as HTMLElement)?.tagName || '').toLowerCase();

    // Ctrl+Z برای undo از بیرون هندل می‌شود؛ اینجا کاری نمی‌کنیم

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (tag === 'input' && (e.target as HTMLInputElement).type === 'number') return;
      if (e.key !== 'Enter') return;
    }

    if (e.key === 'Enter') {
      if (btBuffer.length >= 3) {
        e.preventDefault();
        const code = btBuffer;
        btBuffer = '';
        if (btTimer) {
          clearTimeout(btTimer);
          btTimer = null;
        }
        const st = document.getElementById('btStatus');
        if (st) st.textContent = 'اسکن شد: ' + code;
        emitScan(code, 'bt');
      } else {
        btBuffer = '';
      }
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      btBuffer += e.key;
      if (btTimer) clearTimeout(btTimer);
      btTimer = setTimeout(() => {
        btBuffer = '';
      }, 80);
    }
  });
}

// ——— Helpers for capability detection ———

export function getScannerCapabilities(): {
  mediaDevices: boolean;
  barcodeDetector: boolean;
  html5Qrcode: boolean;
} {
  return {
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    barcodeDetector: 'BarcodeDetector' in window,
    html5Qrcode: typeof (window as any).Html5Qrcode !== 'undefined',
  };
}
