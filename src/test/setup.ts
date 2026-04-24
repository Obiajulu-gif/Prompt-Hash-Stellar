import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { Buffer } from 'buffer';
import * as nodeCrypto from 'node:crypto';

// 1. Force Buffer Polyfill
globalThis.Buffer = Buffer;

// 2. Force Crypto Polyfill (The proper way to bypass "getter-only" restriction)
Object.defineProperty(globalThis, 'crypto', {
  value: nodeCrypto.webcrypto,
  configurable: true,
  writable: true,
});

// 3. Mock window features for JSDOM
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), 
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
