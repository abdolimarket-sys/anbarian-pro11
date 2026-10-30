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
let torchOn = false;

// Html5Qrcode fallback (any برای جلوگیری از وابستگی سخت)
let html5Instance: any = null;

// Serialize camera lifecycle operations: a WebView camera must be fully
// released before another scanner instance can claim it.
let cameraLifecycle: Promise<void> = Promise.resolve();
let cameraRequestId = 0;

function isCurrentCameraRequest(requestId: number): boolean {
  return active && requestId === cameraRequestId;
}

// Debounce / guard
let lastScanTime = 0;
let lastScanCode = '';
const SCAN_COOLDOWN_MS = 200;
const SAME_CODE_COOLDOWN_MS = 700;
let scanFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

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

  const titleEl = document.getElementById('scannerTitle');
  if (titleEl && options?.title) titleEl.textContent = options.title;
  document.getElementById('scannerModal')?.classList.add('show');

  cameraLifecycle = cameraLifecycle
    .then(async () => {
      // Always release any previous engine before reopening the viewfinder.
      await stopCamera();
      if (isCurrentCameraRequest(requestId)) await startCamera(requestId);
    })
    .catch((err) => console.error('[scanner] open lifecycle failed', err));
}

export function closeScanner(): void {
  active = false;
  ++cameraRequestId;
  scanTargetField = null;
  quickMode = false;
  document.getElementById('scannerModal')?.classList.remove('show');

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
  const nextTorchState = !torchOn;
  try {
    // Native BarcodeDetector path owns its MediaStream directly.
    if (nativeStream) {
      const track = nativeStream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as any;
      if (!track || !caps?.torch) {
        toast('این دوربین از چراغ‌قوه پشتیبانی نمی‌کند', 'info');
        return;
      }
      await track.applyConstraints({ advanced: [{ torch: nextTorchState }] as any });
    } else if (html5Instance?.isScanning) {
      // Html5Qrcode owns the camera stream when the HTML5 decoder is active.
      const caps = html5Instance.getRunningTrackCapabilities?.() as any;
      if (!caps?.torch || typeof html5Instance.applyVideoConstraints !== 'function') {
        toast('این دوربین از چراغ‌قوه پشتیبانی نمی‌کند', 'info');
        return;
      }
      await html5Instance.applyVideoConstraints({ advanced: [{ torch: nextTorchState }] });
    } else {
      toast('دوربین هنوز آماده نیست؛ چند لحظه صبر کنید', 'info');
      return;
    }

    torchOn = nextTorchState;
    const btn = document.getElementById('torchBtn');
    if (btn) btn.textContent = torchOn ? '🔦 خاموش' : '🔦 نور';
  } catch (e) {
    console.warn('[scanner] torch failed', e);
    toast('روشن‌کردن چراغ‌قوه ممکن نشد؛ ممکن است دستگاه پشتیبانی نکند', 'info');
  }
}

export function restartCamera(): void {
  if (!active) return;
  const requestId = ++cameraRequestId;
  cameraLifecycle = cameraLifecycle
    .then(async () => {
      await stopCamera();
      if (isCurrentCameraRequest(requestId)) await startCamera(requestId);
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
  if (!shouldAcceptScan(code)) return;

  lastScanTime = Date.now();
  showScanSuccess();
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

function mountScanGuide(host: HTMLElement): void {
  host.querySelector('.scan-guide')?.remove();
  const guide = document.createElement('div');
  guide.className = 'scan-guide';
  guide.innerHTML =
    '<div class="scan-guide-frame"></div><div class="scan-guide-label">بارکد را در کادر قرار دهید</div>';
  host.appendChild(guide);
}

function showScanSuccess(): void {
  const frame = document.querySelector('#scanner-container .scan-guide-frame');
  if (!frame) return;
  frame.classList.remove('is-detected');
  // Force a style boundary so consecutive successful reads retrigger feedback.
  void (frame as HTMLElement).offsetWidth;
  frame.classList.add('is-detected');
  if (scanFeedbackTimer) clearTimeout(scanFeedbackTimer);
  scanFeedbackTimer = setTimeout(() => {
    frame.classList.remove('is-detected');
    scanFeedbackTimer = null;
  }, 420);
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

async function startCamera(requestId: number): Promise<void> {
  if (!isCurrentCameraRequest(requestId)) return;

  torchOn = false;
  const torchButton = document.getElementById('torchBtn');
  if (torchButton) torchButton.textContent = '🔦 نور';

  const diag = cameraDiagMessage();
  if (diag) {
    toast(diag, 'error');
    document.getElementById('manualBarcode')?.focus();
    return;
  }

  // Warm-up only requests permission. The temporary stream is always released.
  let warm: MediaStream | null = null;
  try {
    warm = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  } catch (err: any) {
    if (!isCurrentCameraRequest(requestId)) return;
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      toast('مجوز دوربین داده نشده — دسترسی دوربین برنامه را در تنظیمات گوشی فعال کنید', 'error');
    } else if (name === 'NotFoundError') {
      toast('دوربینی روی این دستگاه پیدا نشد', 'error');
    } else {
      toast('خطا در دسترسی دوربین: ' + (err?.message || name || 'نامشخص'), 'error');
    }
    document.getElementById('manualBarcode')?.focus();
    return;
  } finally {
    warm?.getTracks().forEach((track) => track.stop());
  }

  if (!isCurrentCameraRequest(requestId)) return;

  // Prefer the bundled Html5Qrcode decoder; fall back to BarcodeDetector only
  // when Html5Qrcode is unavailable or cannot start.
  if (typeof (window as any).Html5Qrcode !== 'undefined') {
    const html5Ok = await tryStartHtml5(requestId);
    if (html5Ok || !isCurrentCameraRequest(requestId)) return;
  }

  if (!isCurrentCameraRequest(requestId)) return;
  const nativeOk = await tryStartNative(requestId);
  if (nativeOk || !isCurrentCameraRequest(requestId)) return;

  toast('موتور تشخیص بارکد راه‌اندازی نشد. دوربین را دوباره باز کنید یا از ورود دستی استفاده کنید', 'error');
  document.getElementById('manualBarcode')?.focus();
}

async function tryStartNative(requestId: number): Promise<boolean> {
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
    if (!isCurrentCameraRequest(requestId)) return false;
    const preferred = [
      'ean_13',
      'ean_8',
      'upc_a',
      'upc_e',
      'code_128',
      'code_39',
      'itf',
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
    video.className = 'native-scanner-video';
    video.style.cssText =
      'width:100%;height:100%;display:block;object-fit:contain;background:#0b1f1c';

    host.innerHTML = '';
    host.appendChild(video);

    // راهنمای ثابت؛ بازخورد سبز پس از تشخیص موفق روی همین کادر اعمال می‌شود.
    mountScanGuide(host);

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
    if (!isCurrentCameraRequest(requestId)) {
      stopNative();
      return false;
    }

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

    nativeBusy = false;

    const loop = async () => {
      if (!nativeVideo || !nativeStream || !isCurrentCameraRequest(requestId)) return;
      nativeRaf = requestAnimationFrame(loop);

      // تلاش در هر فریم؛ nativeBusy اجازه هم‌پوشانی عملیات decode را نمی‌دهد.
      if (nativeBusy || video.readyState < 2) return;
      if (opts?.isQtyModalOpen?.()) return;

      nativeBusy = true;
      try {
        // Decode the complete camera frame. Do not crop a central strip:
        // cropping can make the visible left/center/right positions disagree
        // with the pixels that BarcodeDetector actually receives.
        const found = await nativeDetector!.detect(video);
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

async function tryStartHtml5(requestId: number): Promise<boolean> {
  const Html5Qrcode = (window as any).Html5Qrcode;
  const supportedFormats = (window as any).Html5QrcodeSupportedFormats;
  if (!Html5Qrcode || !opts || !isCurrentCameraRequest(requestId)) return false;

  try {
    // A fresh instance avoids stale internal state after closing the modal.
    if (html5Instance) await stopHtml5();
    if (!isCurrentCameraRequest(requestId)) return false;
    html5Instance = new Html5Qrcode(opts.containerId, {
      verbose: false,
      // Force the bundled ZXing decoder: some Android WebViews expose a
      // partial BarcodeDetector that opens the camera but misses EAN/UPC.
      useBarCodeDetectorIfSupported: false,
    });

    const formats = supportedFormats
      ? [
          supportedFormats.EAN_13,
          supportedFormats.EAN_8,
          supportedFormats.UPC_A,
          supportedFormats.UPC_E,
          supportedFormats.CODE_128,
          supportedFormats.CODE_39,
          supportedFormats.ITF,
        ].filter((format: unknown) => typeof format === 'number')
      : undefined;

    await html5Instance.start(
      { facingMode: 'environment' },
      {
        fps: 20,
        // Leave qrbox unset so Html5Qrcode decodes the entire video frame.
        // A cropped qrbox can drift from the displayed preview on WebView
        // devices when the video is scaled to fit the scanner container.
        formatsToSupport: formats,
        disableFlip: true,
      },
      (decoded: string) => {
        if (isCurrentCameraRequest(requestId)) emitScan(decoded, 'html5');
      },
      () => {
        // Per-frame decode misses are expected; do not show an error toast.
      }
    );

    if (!isCurrentCameraRequest(requestId)) {
      await stopHtml5();
      return false;
    }
    const host = document.getElementById(opts.containerId);
    if (host) mountScanGuide(host);
    return true;
  } catch (err: any) {
    console.error('[scanner] html5 failed', err);
    await stopHtml5();
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
  nativeBusy = false;
  torchOn = false;
}

async function stopHtml5(): Promise<void> {
  const instance = html5Instance;
  if (!instance) return;

  try {
    if (instance.isScanning) await instance.stop();
  } catch (err) {
    console.warn('[scanner] Html5Qrcode stop warning', err);
  }

  try {
    if (typeof instance.clear === 'function') await instance.clear();
  } catch (err) {
    // clear() can reject if the library already removed its surface.
    console.warn('[scanner] Html5Qrcode clear warning', err);
  }

  if (html5Instance === instance) html5Instance = null;
}

async function stopCamera(): Promise<void> {
  if (scanFeedbackTimer) {
    clearTimeout(scanFeedbackTimer);
    scanFeedbackTimer = null;
  }
  stopNative();
  await stopHtml5();

  const host = opts ? document.getElementById(opts.containerId) : null;
  if (host) host.innerHTML = '';
  torchOn = false;
  const torchButton = document.getElementById('torchBtn');
  if (torchButton) torchButton.textContent = '🔦 نور';
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
