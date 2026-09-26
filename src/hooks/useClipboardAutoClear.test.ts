import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipboardAutoClear } from "./useClipboardAutoClear";

describe("useClipboardAutoClear", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.mocked(navigator.clipboard, { partial: true });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("initializes with auto-clear enabled by default", () => {
    const { result } = renderHook(() => useClipboardAutoClear());
    expect(result.current.enabled).toBe(true);
  });

  it("copies text to clipboard and starts countdown when enabled", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() => useClipboardAutoClear());

    await act(async () => {
      const success = await result.current.copy("test content");
      expect(success).toBe(true);
      expect(writeText).toHaveBeenCalledWith("test content");
    });

    expect(result.current.remaining).toBe(30);
    expect(result.current.isCountingDown).toBe(true);
  });

  it("does not start countdown when auto-clear is disabled", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() => useClipboardAutoClear());

    await act(async () => {
      result.current.toggle();
    });

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.remaining).toBe(0);
    expect(result.current.isCountingDown).toBe(false);
  });

  it("respects custom delay option", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 60 }),
    );

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.remaining).toBe(60);
  });

  it("verifies clipboard content before clearing (copy A then B)", async () => {
    const readText = vi
      .fn()
      .mockResolvedValueOnce("first content")
      .mockResolvedValueOnce("second content");
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 5 }),
    );

    await act(async () => {
      await result.current.copy("first content");
    });

    expect(result.current.remaining).toBe(5);
    expect(result.current.copiedContent).toBe("first content");

    await act(async () => {
      await result.current.copy("second content");
      vi.advanceTimersByTime(5000);
    });

    expect(writeText).toHaveBeenCalledWith("second content");
  });

  it("clears clipboard when countdown reaches zero if content still matches", async () => {
    const readText = vi.fn().mockResolvedValueOnce("test content");
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 2 }),
    );

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.isCountingDown).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.remaining).toBe(0);
    expect(result.current.isCountingDown).toBe(false);
    expect(writeText).toHaveBeenCalledWith("");
  });

  it("does not clear clipboard if different content was copied", async () => {
    const readText = vi.fn().mockResolvedValueOnce("different content");
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 2 }),
    );

    await act(async () => {
      await result.current.copy("original content");
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(writeText).not.toHaveBeenCalledWith("");
  });

  it("handles visibilitychange event to clear clipboard when tab regains focus", async () => {
    const readText = vi.fn().mockResolvedValueOnce("test content");
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText },
      configurable: true,
    });

    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 10 }),
    );

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.remaining).toBe(10);

    await act(async () => {
      vi.advanceTimersByTime(11000);
      Object.defineProperty(document, "hidden", { value: true });
      const event = new Event("visibilitychange");
      document.dispatchEvent(event);
      Object.defineProperty(document, "hidden", { value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.remaining).toBe(0);
  });

  it("cancels countdown without clearing clipboard", async () => {
    const readText = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { readText, writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 5 }),
    );

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.isCountingDown).toBe(true);

    await act(async () => {
      result.current.cancel();
    });

    expect(result.current.isCountingDown).toBe(false);
    expect(result.current.remaining).toBe(0);
    expect(writeText).not.toHaveBeenCalledWith("");
  });

  it("toggles enabled state and cancels countdown when disabling", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useClipboardAutoClear({ delaySeconds: 5 }),
    );

    await act(async () => {
      await result.current.copy("test content");
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.isCountingDown).toBe(true);

    await act(async () => {
      result.current.toggle();
    });

    expect(result.current.enabled).toBe(false);
    expect(result.current.isCountingDown).toBe(false);
  });

  it("persists enabled state to localStorage", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() => useClipboardAutoClear());

    await act(async () => {
      result.current.toggle();
    });

    expect(localStorage.getItem("prompt-hash:clipboard-autoclear")).toBe(
      "false",
    );

    await act(async () => {
      result.current.toggle();
    });

    expect(localStorage.getItem("prompt-hash:clipboard-autoclear")).toBe(
      "true",
    );
  });

  it("handles clipboard API not available gracefully", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    const { result } = renderHook(() => useClipboardAutoClear());

    await act(async () => {
      const success = await result.current.copy("test content");
      expect(success).toBe(false);
    });
  });
});
