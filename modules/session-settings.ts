/**
 * مدیریت جلسه و تنظیمات کاربردی
 */

import type { AppSettings } from '@/types';
import {
  settings,
  session,
  products,
  startNewSession,
  closeSession,
  saveSettingsNow,
  save,
  isDoubleCount,
  setCountPhase,
  countPhase,
} from './state';
import { toast } from './ui';
import { getOperatorName, setOperatorName } from './storage';
import { clearAllCounts, zeroUncounted, canCount } from './count';

export function getSessionLabel(): string {
  if (!session) return 'جلسه‌ای شروع نشده';
  if (session.closedAt) {
    return (
      'بسته · ' +
      new Date(session.closedAt).toLocaleDateString('fa-IR') +
      ' ' +
      new Date(session.closedAt).toLocaleTimeString('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  }
  return (
    'باز · ' +
    new Date(session.startedAt).toLocaleDateString('fa-IR') +
    ' ' +
    new Date(session.startedAt).toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  );
}

export function isSessionOpen(): boolean {
  return !!(session && !session.closedAt);
}

export function actionStartSession(): void {
  if (!canCount()) {
    toast('نقش مشاهده‌گر اجازه شروع جلسه ندارد', 'error');
    return;
  }
  if (startNewSession(false)) {
    toast('جلسه جدید شروع شد', 'success');
  }
}

export function actionCloseSession(): void {
  if (!session || session.closedAt) {
    toast('جلسه‌ای باز نیست', 'info');
    return;
  }
  if (!confirm('جلسه بسته شود؟ بعد از بستن، شمارش قفل می‌شود.')) return;
  closeSession();
  toast('جلسه بسته شد', 'success');
}

export function actionClearCounts(): void {
  clearAllCounts();
}

export function actionZeroUncounted(): void {
  zeroUncounted();
}

/** اعمال تغییرات فرم تنظیمات به state */
export function applySettingsFromForm(): void {
  const g = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;

  const bool = (id: string, fallback: boolean) => {
    const el = g(id) as HTMLInputElement | null;
    return el ? !!el.checked : fallback;
  };

  settings.continuousScan = bool('setContinuous', settings.continuousScan);
  settings.autoNextScan = bool('setAutoNext', settings.autoNextScan !== false);
  settings.soundOnScan = bool('setSound', settings.soundOnScan);
  settings.vibrateOnScan = bool('setVibrate', settings.vibrateOnScan);
  settings.autoIncrement = bool('setAutoInc', settings.autoIncrement);
  settings.blindCount = bool('setBlind', settings.blindCount);
  settings.btScanner = bool('setBt', settings.btScanner !== false);
  settings.doubleCount = bool('setDouble', settings.doubleCount);

  const role = g('setRole') as HTMLSelectElement | null;
  if (role) settings.role = role.value as AppSettings['role'];

  const wh = g('setWarehouse') as HTMLInputElement | null;
  if (wh && wh.value.trim()) {
    const name = wh.value.trim();
    settings.currentWarehouse = name;
    if (!settings.warehouses.includes(name)) {
      settings.warehouses = [...settings.warehouses, name];
    }
  }

  const op = g('setOperator') as HTMLInputElement | null;
  if (op) setOperatorName(op.value);

  saveSettingsNow();
  toast('تنظیمات ذخیره شد', 'success');
}

export function fillSettingsForm(): void {
  const set = (id: string, checked: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = checked;
  };
  set('setContinuous', !!settings.continuousScan);
  set('setAutoNext', settings.autoNextScan !== false);
  set('setSound', !!settings.soundOnScan);
  set('setVibrate', !!settings.vibrateOnScan);
  set('setAutoInc', !!settings.autoIncrement);
  set('setBlind', !!settings.blindCount);
  set('setBt', settings.btScanner !== false);
  set('setDouble', !!settings.doubleCount);

  const role = document.getElementById('setRole') as HTMLSelectElement | null;
  if (role) role.value = settings.role || 'admin';

  const wh = document.getElementById('setWarehouse') as HTMLInputElement | null;
  if (wh) wh.value = settings.currentWarehouse || 'انبار اصلی';

  const op = document.getElementById('setOperator') as HTMLInputElement | null;
  if (op) op.value = getOperatorName() === 'ناشناس' ? '' : getOperatorName();

  const phaseBar = document.getElementById('phaseBar');
  if (phaseBar) {
    phaseBar.style.display = settings.doubleCount ? 'flex' : 'none';
  }
  updatePhaseButtons();
}

export function updatePhaseButtons(): void {
  const phase = countPhase();
  document.querySelectorAll('[data-phase]').forEach((btn) => {
    const p = Number((btn as HTMLElement).dataset.phase);
    btn.classList.toggle('active', p === phase);
  });
}

export function actionSetPhase(phase: 1 | 2): void {
  if (!isDoubleCount()) {
    toast('شمارش دوفازی خاموش است', 'info');
    return;
  }
  setCountPhase(phase);
  updatePhaseButtons();
  toast(phase === 1 ? 'فاز ۱ فعال شد' : 'فاز ۲ فعال شد', 'success');
}

export function getSettingsSummary(): string {
  const parts = [
    settings.role,
    settings.doubleCount ? 'دوفازی' : null,
    settings.blindCount ? 'کور' : null,
    settings.currentWarehouse,
  ].filter(Boolean);
  return parts.join(' · ');
}
