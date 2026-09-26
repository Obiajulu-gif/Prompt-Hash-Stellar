import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ["/"], description: "Focus the search bar" },
  { keys: ["?"], description: "Show this shortcuts reference" },
  { keys: ["Esc"], description: "Close modal / blur active element" },
  { keys: ["Ctrl", "S"], description: "Save current prompt draft" },
];

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleClose() {
      onClose();
    }
    document.addEventListener("close-modal", handleClose);
    return () => document.removeEventListener("close-modal", handleClose);
  }, [onClose]);

  // Click-outside
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-widest text-slate-500">
              <th className="pb-3 pr-4">Shortcut</th>
              <th className="pb-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map((s, i) => (
              <tr
                key={i}
                className="border-b border-white/5 last:border-0"
              >
                <td className="py-3 pr-4">
                  <span className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center rounded border border-white/20 bg-white/10 px-2 py-0.5 font-mono text-xs text-slate-200"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </td>
                <td className="py-3 text-slate-300">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-slate-500">
          Press <kbd className="rounded border border-white/20 bg-white/10 px-1 font-mono text-xs">Esc</kbd> or click outside to close.
        </p>
      </div>
    </div>
  );
}
