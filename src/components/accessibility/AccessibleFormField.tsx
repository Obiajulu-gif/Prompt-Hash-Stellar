/**
 * Accessible form field wrapper component.
 * Standardizes form field accessibility across the application.
 */

import React, { ReactNode } from 'react';
import { getFormFieldAriaAttrs, getErrorMessageProps, getHelpTextProps, getLabelProps, getRequiredIndicator } from '@/lib/accessibility/formHelpers';

export interface AccessibleFormFieldProps {
  fieldId: string;
  label: string;
  children: ReactNode;
  error?: string;
  helpText?: string;
  isRequired?: boolean;
  className?: string;
}

export function AccessibleFormField({
  fieldId,
  label,
  children,
  error,
  helpText,
  isRequired,
  className = '',
}: AccessibleFormFieldProps) {
  const hasError = !!error;
  const ariaAttrs = getFormFieldAriaAttrs({
    fieldId,
    hasError,
    errorMessage: error,
    helpText,
    isRequired,
  });

  const labelProps = getLabelProps(fieldId, label);
  const errorProps = hasError ? getErrorMessageProps(fieldId) : null;
  const helpProps = helpText && !hasError ? getHelpTextProps(fieldId) : null;

  return (
    <div className={`space-y-2 ${className}`}>
      <label {...labelProps}>
        {label}
        {isRequired && getRequiredIndicator()}
      </label>
      
      {/* Clone children and inject aria attributes */}
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, ariaAttrs)
        : children}
      
      {errorProps && (
        <div {...errorProps}>
          {error}
        </div>
      )}
      
      {helpProps && (
        <div {...helpProps}>
          {helpText}
        </div>
      )}
    </div>
  );
}

export default AccessibleFormField;
