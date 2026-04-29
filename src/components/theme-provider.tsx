import { useEffect } from 'react'
import { useTheme } from '../hooks/useTheme'

interface ThemeProviderProps {
  children: React.ReactNode
}

/**
 * ThemeProvider initializes theme detection on app mount
 * Integrates with useTheme to manage light/dark/system themes
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  // Initialize theme once on mount
  useTheme()
  
  return <>{children}</>
}
