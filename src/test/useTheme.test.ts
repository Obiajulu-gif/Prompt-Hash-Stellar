import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme, applyThemeBeforeRender } from '../hooks/useTheme'

describe('Theme Management', () => {
  beforeEach(() => {
    // Clear localStorage and DOM state before each test
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  describe('applyThemeBeforeRender', () => {
    it('should apply light theme when no preference is stored', () => {
      applyThemeBeforeRender()

      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })

    it('should apply dark theme when stored preference is dark', () => {
      localStorage.setItem('theme-preference', 'dark')

      applyThemeBeforeRender()

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('should apply system preference when stored preference is system', () => {
      localStorage.setItem('theme-preference', 'system')

      // Mock system preference to dark
      const mockMatchMedia = vi.fn(() => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
      window.matchMedia = mockMatchMedia

      applyThemeBeforeRender()

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('should handle missing window gracefully (SSR)', () => {
      const originalWindow = global.window
      // @ts-ignore
      delete global.window

      expect(() => applyThemeBeforeRender()).not.toThrow()

      global.window = originalWindow
    })
  })

  describe('useTheme', () => {
    it('should initialize with system theme by default', () => {
      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBe('system')
    })

    it('should restore saved theme preference from localStorage', () => {
      localStorage.setItem('theme-preference', 'dark')

      const { result } = renderHook(() => useTheme())

      expect(result.current.theme).toBe('dark')
    })

    it('should toggle theme and persist to localStorage', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.toggleTheme('dark')
      })

      expect(result.current.theme).toBe('dark')
      expect(localStorage.getItem('theme-preference')).toBe('dark')
    })

    it('should apply dark class to document when theme is dark', () => {
      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.toggleTheme('dark')
      })

      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('should remove dark class from document when theme is light', () => {
      localStorage.setItem('theme-preference', 'dark')
      document.documentElement.classList.add('dark')

      const { result } = renderHook(() => useTheme())

      act(() => {
        result.current.toggleTheme('light')
      })

      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })

    it('should follow system preference changes when theme is system', () => {
      const { result } = renderHook(() => useTheme())

      const mockMatchMedia = vi.fn(() => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
      window.matchMedia = mockMatchMedia

      act(() => {
        result.current.toggleTheme('system')
      })

      expect(result.current.isDark).toBe(true)
    })

    it('should persist theme selection across hook instances', () => {
      const { result: result1 } = renderHook(() => useTheme())

      act(() => {
        result1.current.toggleTheme('dark')
      })

      const { result: result2 } = renderHook(() => useTheme())

      expect(result2.current.theme).toBe('dark')
    })

    it('should handle theme transitions correctly', () => {
      const { result } = renderHook(() => useTheme())

      // Start with light theme
      act(() => {
        result.current.toggleTheme('light')
      })
      expect(result.current.theme).toBe('light')
      expect(result.current.isDark).toBe(false)

      // Switch to dark
      act(() => {
        result.current.toggleTheme('dark')
      })
      expect(result.current.theme).toBe('dark')
      expect(result.current.isDark).toBe(true)

      // Switch to system
      act(() => {
        result.current.toggleTheme('system')
      })
      expect(result.current.theme).toBe('system')
    })
  })
})
