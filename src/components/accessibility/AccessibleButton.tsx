/**
 * Accessible button component.
 * Ensures buttons have clear labels and proper focus management.
 */

import React, { ReactNode, ButtonHTMLAttributes } from 'react';

export interface AccessibleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  ariaLabel?: string;
  ariaPressed?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantClasses = {
  primary: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus:ring-emerald-500',
  secondary: 'bg-slate-800 text-white hover:bg-slate-700 focus:ring-slate-600',
  danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
  ghost: 'bg-transparent text-slate-300 hover:text-white focus:ring-slate-500',
};

const sizeClasses = {
  sm: 'px-3 py-1 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

export function AccessibleButton({
  children,
  ariaLabel,
  ariaPressed,
  isLoading = false,
  loadingLabel = 'Loading...',
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  className = '',
  ...props
}: AccessibleButtonProps) {
  const buttonDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      disabled={buttonDisabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-busy={isLoading}
      className={`
        rounded font-medium transition-colors
        focus:outline-none focus:ring-1
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    >
      {isLoading ? loadingLabel : children}
    </button>
  );
}

export default AccessibleButton;
