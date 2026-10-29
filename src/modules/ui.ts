/**
 * توابع UI پایه (toast، navigation ساده و ...)
 */

import type { ToastType } from '@/types';
import { Capacitor } from '@capacitor/core';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, type: ToastType = 'info'): void {
  // در اندروید پیام موفقیت دانلود را فقط بعد از تأیید واقعی ذخیره نشان می‌دهیم.
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && /دانلود شد|فایل ذخیره شد/.test(message)) return;
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.className = `toast show ${type}`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el?.classList.remove('show');
  }, 2800);
}

export function showPage(pageId: string): void {
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.remove('active');
  });
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');

  // nav active state
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-page') === pageId);
  });
}

export function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('anbar_theme', theme);
}

export function loadTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem('anbar_theme') as 'light' | 'dark' | null;
  if (saved) {
    setTheme(saved);
    return saved;
  }
  // prefer system
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = prefersDark ? 'dark' : 'light';
  setTheme(theme);
  return theme;
}
