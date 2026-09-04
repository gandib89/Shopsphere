type SectionBounds = { top: number; height: number };

const EDGE_TOLERANCE = 3;
const GESTURE_PAUSE_MS = 200;
const INTENT_THRESHOLD_PX = 24;

// Tall sections get intermediate stops so snapping never skips their content.
export function sectionScrollStops(sections: SectionBounds[], viewportHeight: number, headerBottom: number, documentHeight: number) {
  const offset = Math.max(0, headerBottom) + 12;
  const availableHeight = Math.max(100, viewportHeight - offset - 16);
  const pageStep = Math.max(100, availableHeight - 48);
  const maxScroll = Math.max(0, documentHeight - viewportHeight);
  const stops = [0];
  for (const section of sections) {
    const start = Math.max(0, section.top - offset);
    const overflow = Math.max(0, section.height - availableHeight);
    stops.push(start);
    for (let page = pageStep; page < overflow; page += pageStep) stops.push(start + page);
    if (overflow > EDGE_TOLERANCE) stops.push(start + overflow);
  }
  stops.push(maxScroll);
  return stops.map(stop => Math.min(maxScroll, stop)).sort((a, b) => a - b)
    .filter((stop, index, all) => index === 0 || stop - all[index - 1] > EDGE_TOLERANCE);
}

export function installSectionScroll(root: HTMLElement) {
  let lastWheelAt = -Infinity;
  let direction = 0;
  let accumulated = 0;
  let consumed = false;
  let destination: number | null = null;

  const reset = () => {
    lastWheelAt = -Infinity;
    accumulated = 0;
    consumed = false;
    destination = null;
  };
  const onScrollEnd = () => { destination = null; };

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Modal, menu, search and native input scrolling must not move the page.
    if (root.querySelector('[role="dialog"], .ux-demo-search-categories, .ui-redesign-mobile-nav')
      || target.closest('input, textarea, select, [contenteditable="true"], [data-section-scroll-ignore]')) {
      reset();
      return;
    }
    for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + EDGE_TOLERANCE && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
        reset();
        return;
      }
    }

    const now = performance.now();
    const nextDirection = Math.sign(event.deltaY);
    if (now - lastWheelAt > GESTURE_PAUSE_MS || direction !== nextDirection) {
      accumulated = 0;
      consumed = false;
    }
    lastWheelAt = now;
    direction = nextDirection;
    event.preventDefault();
    // Consume the tail of a trackpad gesture, even after native smooth scrolling ends.
    if (consumed) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    accumulated += Math.abs(event.deltaY) * unit;
    if (accumulated < INTENT_THRESHOLD_PX) return;
    consumed = true;

    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-section]')).map(section => {
      const rect = section.getBoundingClientRect();
      return { top: rect.top + window.scrollY, height: rect.height };
    });
    const headerBottom = root.querySelector('.ux-demo-header-theme')?.getBoundingClientRect().bottom ?? 0;
    const stops = sectionScrollStops(sections, window.innerHeight, headerBottom, document.documentElement.scrollHeight);
    // A fresh gesture can retarget a still-running native scroll without restarting from the old section.
    const anchor = destination ?? window.scrollY;
    const next = direction > 0
      ? stops.find(stop => stop > anchor + EDGE_TOLERANCE)
      : [...stops].reverse().find(stop => stop < anchor - EDGE_TOLERANCE);
    if (next === undefined) return;
    destination = next;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: next, behavior: reducedMotion ? 'instant' : 'smooth' });
  };

  root.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scrollend', onScrollEnd);
  // Let manual navigation interrupt a snap and discard its pending destination.
  window.addEventListener('pointerdown', reset);
  window.addEventListener('touchstart', reset, { passive: true });
  window.addEventListener('keydown', reset);
  window.addEventListener('resize', reset);
  return () => {
    root.removeEventListener('wheel', onWheel);
    window.removeEventListener('scrollend', onScrollEnd);
    window.removeEventListener('pointerdown', reset);
    window.removeEventListener('touchstart', reset);
    window.removeEventListener('keydown', reset);
    window.removeEventListener('resize', reset);
  };
}
