import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSectionScroll, sectionScrollStops } from './sectionScroll';

describe('section scroll stops', () => {
  it.each([[898, 105], [844, 163]])('advances straight from a screen-filling hero to products at viewport %i', (viewport, header) => {
    const stage = { top: header + 12, height: viewport - header - 28 };
    const products = { top: viewport + 16, height: 1200 };
    const stops = sectionScrollStops([stage, products], viewport, header, 4000);
    expect(stops[0]).toBe(0);
    expect(stops[1]).toBe(products.top - header - 12);
  });

  it('aligns section starts below the sticky header and clamps to the page bottom', () => {
    expect(sectionScrollStops([
      { top: 100, height: 600 }, { top: 800, height: 600 }, { top: 1500, height: 300 },
    ], 900, 100, 1900)).toEqual([0, 688, 1000]);
  });

  it('keeps every part of tall sections reachable with overlapping viewport stops', () => {
    expect(sectionScrollStops([{ top: 800, height: 1900 }], 900, 100, 3200))
      .toEqual([0, 688, 1412, 1816, 2300]);
  });

  it('does not scroll documents shorter than the viewport', () => {
    expect(sectionScrollStops([{ top: 100, height: 400 }], 900, 100, 600)).toEqual([0]);
  });
});

describe('UX demo wheel navigation', () => {
  let root: HTMLDivElement;
  let section: HTMLElement;
  let dispose: () => void;
  let now: number;
  let scrollY: number;
  const originalHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight');

  const wheel = (init: WheelEventInit = {}, target: Element = section) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, ...init });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    now = 0;
    scrollY = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3300 });
    root = document.createElement('div');
    const header = document.createElement('header');
    header.className = 'ux-demo-header-theme';
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ bottom: 100 } as DOMRect);
    root.append(header);
    for (const top of [100, 800, 1600, 2400]) {
      const element = document.createElement('section');
      element.dataset.scrollSection = '';
      vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({ top: top - scrollY, height: 600 }) as DOMRect);
      root.append(element);
    }
    section = root.querySelector('section')!;
    document.body.append(root);
    dispose = installSectionScroll(root);
  });

  afterEach(() => {
    dispose();
    root.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalHeight) Object.defineProperty(document.documentElement, 'scrollHeight', originalHeight);
    else Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  });

  it('moves once per wheel gesture and consumes momentum after scroll completion', () => {
    expect(wheel().defaultPrevented).toBe(true);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 688, behavior: 'smooth' });
    now = 100;
    wheel();
    scrollY = 688;
    window.dispatchEvent(new Event('scrollend'));
    now = 180;
    wheel({ deltaY: 30 });
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    now = 500;
    wheel();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 1488, behavior: 'smooth' });
  });

  it('retargets an in-progress scroll on a fresh gesture, including upward reversal', () => {
    wheel();
    now = 250;
    wheel();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 1488, behavior: 'smooth' });
    now = 300;
    wheel({ deltaY: -120 });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 688, behavior: 'smooth' });
  });

  it('accumulates small pixel deltas and supports line and page wheel units', () => {
    wheel({ deltaY: 12 });
    expect(window.scrollTo).not.toHaveBeenCalled();
    now = 30;
    wheel({ deltaY: 12 });
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    now = 300;
    wheel({ deltaY: 3, deltaMode: 1 });
    now = 600;
    wheel({ deltaY: 1, deltaMode: 2 });
    expect(window.scrollTo).toHaveBeenCalledTimes(3);
  });

  it('jumps immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    wheel();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 688, behavior: 'instant' });
  });

  it('leaves zoom, horizontal and modified gestures native', () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { deltaX: 200 }, { cancelable: false }]) {
      expect(wheel(init).defaultPrevented).toBe(false);
    }
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('leaves inputs and nested scrolling containers alone', () => {
    const input = document.createElement('input');
    const nested = document.createElement('div');
    nested.style.overflowY = 'auto';
    Object.defineProperties(nested, { scrollHeight: { value: 500 }, clientHeight: { value: 200 } });
    const child = document.createElement('button');
    nested.append(child);
    root.append(input, nested);
    expect(wheel({}, input).defaultPrevented).toBe(false);
    expect(wheel({}, child).defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('leaves sections marked for natural scrolling outside snap control', () => {
    section.dataset.sectionScrollIgnore = '';
    expect(wheel().defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it.each(['dialog', 'categories', 'mobile menu'])('does not snap while a %s is open', (type) => {
    const overlay = document.createElement('div');
    if (type === 'dialog') overlay.setAttribute('role', 'dialog');
    else overlay.className = type === 'categories' ? 'ux-demo-search-categories' : 'ui-redesign-mobile-nav';
    root.append(overlay);
    expect(wheel().defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it.each(['pointerdown', 'touchstart', 'keydown', 'resize'])('discards stale destinations after %s', (type) => {
    wheel();
    scrollY = 1500;
    window.dispatchEvent(new Event(type));
    now = 300;
    wheel();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 2288, behavior: 'smooth' });
  });

  it('does not interfere with gestures outside the demo or after cleanup', () => {
    expect(wheel({}, document.body).defaultPrevented).toBe(false);
    dispose();
    expect(wheel().defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
