/**
 * Accessible modal dialog component.
 * Implements WCAG 2.1 modal dialog pattern with focus trapping and restoration.
 */

import React, { useEffect, useRef, ReactNode } from 'react';
import { createFocusTrap, setFocusOn } from '@/lib/accessibility/formHelpers';

export interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function AccessibleModal({
  isOpen,
  onClose,
  title,
  children,
  className = '',
  contentClassName = '',
}: AccessibleModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save currently focused element
    lastActiveElementRef.current = document.activeElement as HTMLElement;

    // Set initial focus to modal title for screen readers
    const titleElement = modalRef.current?.querySelector('h2') as HTMLElement;
    if (titleElement) {
      setTimeout(() => setFocusOn(titleElement), 0);
    }

    // Create focus trap
    const trap = createFocusTrap(modalRef.current!);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape key
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Handle Tab key with focus trap
      trap.handleKeyDown(e);
    };

    modalRef.current?.addEventListener('keydown', handleKeyDown);

    // Prevent body scroll when modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      modalRef.current?.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;

      // Restore focus when modal closes
      if (lastActiveElementRef.current) {
        lastActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
      >
        <div
          className={`bg-slate-900 border border-white/10 rounded-lg shadow-lg max-w-lg w-full mx-4 ${contentClassName}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <h2 id="modal-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1 text-slate-400 hover:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 rounded"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export default AccessibleModal;
