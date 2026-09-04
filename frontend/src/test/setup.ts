import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
Object.defineProperty(Element.prototype, 'scrollBy', { configurable: true, value: vi.fn() });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;

afterEach(cleanup);
