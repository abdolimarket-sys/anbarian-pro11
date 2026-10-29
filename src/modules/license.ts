/**
 * سیستم لایسنس (سازگار با فرمت ANB3 نسخه قدیم)
 * - ۱۴ روز آزمایشی
 * - قفل دستگاه
 * - تشخیص دستکاری ساعت / seal
 *
 * توجه: لایسنس سمت‌کلاینت همیشه قابل دور زدن است؛
 * این لایه برای استفاده تجاری سبک و سازگاری با کلیدهای قبلی است.
 */

import { toast } from './ui';
import { showPage } from './ui';

const LICENSE_SECRET = 'anbar-azar-lic-v3-7f3a9c2e8b1d';
const TRIAL_DAYS = 14;
const LICENSE_FORMAT_V = 3;

export interface LicenseRecord {
  org: string;
  exp: string;
  plan: string;
  device?: string | null;
  demo?: boolean;
  v?: number;
  seal?: string;
  activatedAt?: string;
}

export interface LicenseState {
  trialActive: boolean;
  trialLeft: number;
  trialEnd: string;
  licensed: boolean;
  license: LicenseRecord | null;
  deviceMismatch: boolean;
  sealBroken: boolean;
  clockTamper: boolean;
  premium: boolean;
  installId: string;
  deviceId: string;
  firstAt: string;
  plan: string;
}

interface InstallMeta {
  firstAt: string;
  id: string;
  lastSeen: number;
  clockTamper?: boolean;
}

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function licenseSign(material: string): string {
  const a = djb2(material + '|' + LICENSE_SECRET);
  const b = fnv1a(LICENSE_SECRET + '|' + material + '|' + a);
  const c = djb2(b + material + fnv1a(LICENSE_SECRET));
  return (a + b + c).slice(0, 20);
}

export function getInstallMeta(): InstallMeta {
  let m: InstallMeta | null = null;
  try {
    m = JSON.parse(localStorage.getItem('anbar_install') || 'null');
  } catch {
    m = null;
  }
  if (!m || !m.firstAt) {
    const entropy = [
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      String((navigator.userAgent || '').length),
      String(screen.width || 0),
      String(screen.height || 0),
    ].join('');
    m = {
      firstAt: new Date().toISOString(),
      id: 'D' + licenseSign(entropy).slice(0, 14),
      lastSeen: Date.now(),
    };
    localStorage.setItem('anbar_install', JSON.stringify(m));
  }
  if (!m.id) {
    m.id = 'D' + licenseSign(String(Date.now())).slice(0, 14);
    localStorage.setItem('anbar_install', JSON.stringify(m));
  }
  const now = Date.now();
  if (m.lastSeen && now < m.lastSeen - 3600000) m.clockTamper = true;
  m.lastSeen = Math.max(now, m.lastSeen || 0);
  try {
    localStorage.setItem('anbar_install', JSON.stringify(m));
  } catch {
    // ignore
  }
  return m;
}

export function getDeviceId(): string {
  return getInstallMeta().id;
}

function sealLicenseRecord(lic: LicenseRecord): LicenseRecord {
  const body = {
    org: lic.org,
    exp: lic.exp,
    plan: lic.plan || 'full',
    device: lic.device || null,
    demo: !!lic.demo,
    v: LICENSE_FORMAT_V,
  };
  const seal = licenseSign(JSON.stringify(body) + '|' + getDeviceId());
  return {
    ...body,
    seal,
    activatedAt: lic.activatedAt || new Date().toISOString(),
  };
}

function verifySealedLicense(rec: LicenseRecord | null): LicenseRecord | null {
  if (!rec || !rec.seal) return null;
  const body = {
    org: rec.org,
    exp: rec.exp,
    plan: rec.plan || 'full',
    device: rec.device || null,
    demo: !!rec.demo,
    v: rec.v || LICENSE_FORMAT_V,
  };
  if (licenseSign(JSON.stringify(body) + '|' + getDeviceId()) !== rec.seal) return null;
  if (rec.device && rec.device !== getDeviceId()) return null;
  return rec;
}

export function getStoredLicense(): LicenseRecord | null {
  try {
    return verifySealedLicense(JSON.parse(localStorage.getItem('anbar_license') || 'null'));
  } catch {
    return null;
  }
}

export function saveStoredLicense(lic: LicenseRecord | null): void {
  if (lic) localStorage.setItem('anbar_license', JSON.stringify(sealLicenseRecord(lic)));
  else localStorage.removeItem('anbar_license');
}

/** پارس کلید ANB3.... یا فرمت‌های قدیمی */
export function parseLicenseKey(key: string): LicenseRecord | null {
  key = (key || '').trim();
  if (!key) return null;

  // ANB3.payload.sig
  if (key.startsWith('ANB3.') || key.startsWith('ANBAR-')) {
    let payload = '';
    let sig = '';
    if (key.startsWith('ANB3.')) {
      const parts = key.split('.');
      if (parts.length < 3) return null;
      payload = parts[1];
      sig = parts[2];
      if (licenseSign(payload) !== sig) {
        // سازگاری با امضاهای قدیمی کوتاه‌تر
        const old1 = djb2(payload + '|anbar-azar-phase-c-2026-v2').slice(0, 10);
        const old2 = djb2(payload + '|anbar-azar-phase-c-2026').slice(0, 8);
        if (sig !== old1 && sig !== old2) return null;
      }
    } else {
      // ANBAR- legacy: try base64 body
      try {
        const raw = key.replace(/^ANBAR-/, '');
        const json = JSON.parse(decodeURIComponent(escape(atob(raw))));
        if (!json?.exp) return null;
        return {
          org: json.org || 'لایسنس',
          exp: json.exp,
          plan: json.plan || 'full',
          device: json.device || null,
          demo: !!json.demo,
        };
      } catch {
        return null;
      }
    }

    try {
      const json = JSON.parse(decodeURIComponent(escape(atob(payload))));
      if (!json || !json.exp) return null;
      if (key.startsWith('ANB3.') && !json.demo && !json.device) return null;
      return {
        org: json.org || 'لایسنس',
        exp: json.exp,
        plan: json.plan || 'full',
        device: json.device || null,
        demo: !!json.demo,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function makeLicenseKey(opts: {
  org?: string;
  exp?: string;
  plan?: string;
  device?: string | null;
  demo?: boolean;
  allowOpen?: boolean;
}): string {
  const plan = opts.plan || 'standard';
  let device = opts.device || null;
  if (!opts.demo && !opts.allowOpen && !device) {
    throw new Error('device_required');
  }
  const body = {
    org: opts.org || 'مشتری',
    exp: opts.exp || '2099-12-31',
    plan,
    device,
    demo: !!opts.demo,
    v: LICENSE_FORMAT_V,
    iat: new Date().toISOString().slice(0, 10),
  };
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(body))));
  return 'ANB3.' + payload + '.' + licenseSign(payload);
}

export function getLicenseState(): LicenseState {
  const install = getInstallMeta();
  const first = new Date(install.firstAt).getTime();
  const now = Date.now();
  let trialEnd = first + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  if (install.clockTamper) trialEnd = first;
  const trialLeft = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
  const trialActive = now < trialEnd && !install.clockTamper;
  const lic = getStoredLicense();

  let licensed = false;
  let licInfo: LicenseRecord | null = null;
  let deviceMismatch = false;
  let sealBroken = false;

  try {
    const raw = JSON.parse(localStorage.getItem('anbar_license') || 'null');
    if (raw && !lic) {
      if (raw.device && raw.device !== getDeviceId()) deviceMismatch = true;
      else sealBroken = true;
    }
  } catch {
    // ignore
  }

  if (lic?.exp) {
    const expOk =
      lic.exp === '2099-12-31' ||
      (!isNaN(new Date(lic.exp).getTime()) && new Date(lic.exp).getTime() > now);
    if (expOk) {
      if (lic.device && lic.device !== getDeviceId()) deviceMismatch = true;
      else {
        licensed = true;
        licInfo = lic;
      }
    }
  }

  return {
    trialActive,
    trialLeft,
    trialEnd: new Date(trialEnd).toISOString(),
    licensed,
    license: licInfo,
    deviceMismatch,
    sealBroken,
    clockTamper: !!install.clockTamper,
    premium: licensed || trialActive,
    installId: install.id,
    deviceId: getDeviceId(),
    firstAt: install.firstAt,
    plan: (licInfo && licInfo.plan) || (trialActive ? 'trial' : 'none'),
  };
}

export function isPremium(): boolean {
  return !!getLicenseState().premium;
}

export function requirePremium(feature?: string): boolean {
  if (isPremium()) return true;
  toast(
    'نسخه آزمایشی تمام شده — برای «' + (feature || 'این قابلیت') + '» لایسنس فعال کنید',
    'error'
  );
  showPage('admin');
  updateLicenseUI();
  return false;
}

export function activateLicenseFromInput(): boolean {
  const inp = document.getElementById('licenseKeyInput') as HTMLInputElement | null;
  const key = (inp?.value || '').trim();
  if (!key) {
    toast('کلید لایسنس را وارد کنید', 'error');
    return false;
  }
  const parsed = parseLicenseKey(key);
  if (!parsed) {
    toast('کلید نامعتبر است', 'error');
    return false;
  }
  if (parsed.device && parsed.device !== getDeviceId()) {
    toast('این کلید برای دستگاه دیگری صادر شده', 'error');
    return false;
  }
  // اگر کلید بدون device است و demo نیست، به این دستگاه قفل می‌شود
  if (!parsed.demo && !parsed.device) {
    parsed.device = getDeviceId();
  }
  parsed.activatedAt = new Date().toISOString();
  saveStoredLicense(parsed);
  toast('لایسنس فعال شد', 'success');
  updateLicenseUI();
  return true;
}

export function deactivateLicense(): void {
  if (!confirm('لایسنس حذف شود؟')) return;
  saveStoredLicense(null);
  toast('لایسنس حذف شد', 'info');
  updateLicenseUI();
}

export function updateLicenseUI(): void {
  const st = getLicenseState();
  let text = '';
  if (st.clockTamper) text = '⚠️ تغییر ساعت سیستم — آزمایشی غیرفعال';
  else if (st.sealBroken) text = '⚠️ لایسنس ذخیره‌شده نامعتبر یا دستکاری‌شده';
  else if (st.deviceMismatch) text = '⚠️ لایسنس متعلق به دستگاه دیگر است';
  else if (st.licensed)
    text =
      '✅ لایسنس فعال — ' +
      (st.license?.org || '') +
      ' | ' +
      (st.license?.plan || '') +
      ' | تا ' +
      (st.license?.exp || '') +
      (st.license?.device ? ' | قفل‌دستگاه' : '');
  else if (st.trialActive) text = '⏳ آزمایشی — ' + st.trialLeft + ' روز باقی';
  else text = '🔒 آزمایشی تمام — شمارش آزاد؛ خروجی حرفه‌ای نیاز به لایسنس';

  const el = document.getElementById('licenseDetail');
  if (el) el.textContent = text;
  const did = document.getElementById('deviceIdDisplay') as HTMLInputElement | null;
  if (did) did.value = st.deviceId;
}

/** تولید کلید برای ادمین (ابزار داخلی) */
export function generateDemoKeyForThisDevice(days = 365): string {
  const exp = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return makeLicenseKey({
    org: 'مشتری',
    exp,
    plan: 'full',
    device: getDeviceId(),
    demo: false,
  });
}
