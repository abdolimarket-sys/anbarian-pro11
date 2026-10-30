/**
 * Virtual List ساده و سبک
 * فقط آیتم‌های داخل viewport (+ overscan) رندر می‌شوند.
 */

export interface VirtualListOptions<T> {
  /** عنصر اسکرول‌شونده (معمولاً خود container) */
  container: HTMLElement;
  /** ارتفاع تقریبی/ثابت هر ردیف به پیکسل */
  rowHeight: number;
  /** تعداد ردیف اضافه بالا/پایین viewport */
  overscan?: number;
  /** داده */
  getItems: () => T[];
  /** رندر یک ردیف — باید HTMLElement برگرداند */
  renderRow: (item: T, index: number) => HTMLElement;
  /** کلید پایدار برای هر آیتم (برای reuse اختیاری) */
  getKey?: (item: T, index: number) => string;
  /** کلاس روی spacer/inner */
  className?: string;
}

export interface VirtualListHandle {
  refresh: () => void;
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
  destroy: () => void;
}

export function createVirtualList<T>(options: VirtualListOptions<T>): VirtualListHandle {
  const {
    container,
    rowHeight,
    overscan = 6,
    getItems,
    renderRow,
    getKey,
  } = options;

  // ساختار DOM:
  // container (overflow:auto)
  //   └── spacer (height = total)
  //         └── inner (position:absolute; top = start*rowHeight)
  //               └── rows...

  container.style.position = container.style.position || 'relative';
  container.style.overflow = container.style.overflow || 'auto';
  container.innerHTML = '';

  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  spacer.style.width = '100%';
  spacer.style.pointerEvents = 'none';

  const inner = document.createElement('div');
  inner.style.position = 'absolute';
  inner.style.left = '0';
  inner.style.right = '0';
  inner.style.top = '0';
  inner.style.pointerEvents = 'auto';

  spacer.appendChild(inner);
  container.appendChild(spacer);

  let raf = 0;
  let lastStart = -1;
  let lastEnd = -1;
  let destroyed = false;

  // pool ساده برای reuse عناصر
  const pool: HTMLElement[] = [];
  const keyToEl = new Map<string, HTMLElement>();

  function totalHeight(count: number): number {
    return count * rowHeight;
  }

  function render(): void {
    if (destroyed) return;
    const items = getItems();
    const count = items.length;
    spacer.style.height = totalHeight(count) + 'px';

    if (count === 0) {
      inner.innerHTML = '';
      inner.style.transform = 'translateY(0)';
      lastStart = lastEnd = -1;
      // empty state
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.style.padding = '16px';
      empty.textContent = 'موردی برای نمایش نیست.';
      empty.style.pointerEvents = 'none';
      inner.appendChild(empty);
      return;
    }

    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight || 400;

    let start = Math.floor(scrollTop / rowHeight) - overscan;
    let end = Math.ceil((scrollTop + viewH) / rowHeight) + overscan;
    start = Math.max(0, start);
    end = Math.min(count, end);

    if (start === lastStart && end === lastEnd) return;
    lastStart = start;
    lastEnd = end;

    inner.style.transform = `translateY(${start * rowHeight}px)`;

    // جمع‌آوری کلیدهای مورد نیاز
    const needed = new Set<string>();
    const fragment = document.createDocumentFragment();
    const usedEls = new Set<HTMLElement>();

    for (let i = start; i < end; i++) {
      const item = items[i];
      const key = getKey ? getKey(item, i) : String(i);
      needed.add(key);

      let el = keyToEl.get(key);
      if (!el) {
        const reused = pool.pop();
        if (reused) {
          reused.innerHTML = '';
          reused.className = '';
        }
        // همیشه از renderRow تازه می‌سازیم تا محتوا درست باشد
        el = renderRow(item, i);
        el.dataset.vk = key;
        el.style.height = rowHeight + 'px';
        el.style.boxSizing = 'border-box';
        keyToEl.set(key, el);
      } else {
        // به‌روزرسانی محتوا در صورت نیاز — برای سادگی دوباره رندر می‌کنیم
        const fresh = renderRow(item, i);
        el.className = fresh.className;
        el.innerHTML = fresh.innerHTML;
        // کپی data attributes مهم
        Array.from(fresh.attributes).forEach((attr) => {
          if (attr.name.startsWith('data-') || attr.name === 'id') {
            el!.setAttribute(attr.name, attr.value);
          }
        });
        el.style.height = rowHeight + 'px';
        el.style.boxSizing = 'border-box';
      }
      usedEls.add(el);
      fragment.appendChild(el);
    }

    // عناصر بلااستفاده را به pool برگردان
    keyToEl.forEach((el, key) => {
      if (!needed.has(key)) {
        keyToEl.delete(key);
        if (el.parentNode) el.parentNode.removeChild(el);
        if (pool.length < 40) {
          el.innerHTML = '';
          pool.push(el);
        }
      }
    });

    inner.innerHTML = '';
    inner.appendChild(fragment);
  }

  function schedule(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  const onScroll = () => schedule();
  container.addEventListener('scroll', onScroll, { passive: true });

  // مشاهده تغییر اندازه
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => schedule());
    ro.observe(container);
  }

  // رندر اولیه
  render();

  return {
    refresh() {
      lastStart = lastEnd = -1;
      schedule();
    },
    scrollToIndex(index: number, align: 'start' | 'center' | 'end' = 'center') {
      const items = getItems();
      if (!items.length) return;
      index = Math.max(0, Math.min(items.length - 1, index));
      let top = index * rowHeight;
      if (align === 'center') {
        top = top - container.clientHeight / 2 + rowHeight / 2;
      } else if (align === 'end') {
        top = top - container.clientHeight + rowHeight;
      }
      container.scrollTop = Math.max(0, top);
      schedule();
    },
    destroy() {
      destroyed = true;
      container.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      keyToEl.clear();
      pool.length = 0;
      container.innerHTML = '';
    },
  };
}
