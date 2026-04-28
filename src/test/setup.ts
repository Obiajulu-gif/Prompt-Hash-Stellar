import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const walletModuleMocks = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  fetchBalance: vi.fn().mockResolvedValue([]),
  wallet: {
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
    setWallet: vi.fn(),
    getAddress: vi.fn().mockResolvedValue({ address: "" }),
    getNetwork: vi.fn().mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    }),
    disconnect: vi.fn(),
  },
}));

vi.mock("@/util/wallet", () => walletModuleMocks);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
}

if (!("PointerEvent" in globalThis) && "MouseEvent" in globalThis) {
  Object.defineProperty(globalThis, "PointerEvent", {
    writable: true,
    value: MouseEvent,
  });
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
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

  if (!window.scrollTo) {
    Object.defineProperty(window, "scrollTo", {
      writable: true,
      value: vi.fn(),
    });
  }
}

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      writable: true,
      value: vi.fn(),
    });
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      writable: true,
      value: vi.fn(() => false),
    });
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      writable: true,
      value: vi.fn(),
    });
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      writable: true,
      value: vi.fn(),
    });
  }
}
