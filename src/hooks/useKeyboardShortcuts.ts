import { useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  onShowShortcuts: () => void;
}

export function useKeyboardShortcuts({
  onShowShortcuts,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // `/` — focus search bar (skip when already typing)
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder*="earch"], input[type="search"]'
        );
        searchInput?.focus();
        return;
      }

      // `Escape` — close modals / blur active element
      if (e.key === "Escape") {
        document.dispatchEvent(new CustomEvent("close-modal"));
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      // `Ctrl/Cmd + S` — save-prompt
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("save-prompt"));
        return;
      }

      // `?` — show shortcuts modal (skip when typing)
      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        onShowShortcuts();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onShowShortcuts]);
}
