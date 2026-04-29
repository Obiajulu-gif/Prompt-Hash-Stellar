import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = localStorage.getItem('theme-preference') as Theme | null
    return stored || 'system'
  })

  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const updateTheme = () => {
      let isDarkMode = theme === 'dark'
      
      if (theme === 'system') {
        isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
      }
      
      setIsDark(isDarkMode)
      
      const html = document.documentElement
      if (isDarkMode) {
        html.classList.add('dark')
        document.documentElement.style.colorScheme = 'dark'
      } else {
        html.classList.remove('dark')
        document.documentElement.style.colorScheme = 'light'
      }
    }

    updateTheme()

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => updateTheme()
      
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  const toggleTheme = (newTheme: Theme) => {
    setTheme(newTheme)
    localStorage.setItem('theme-preference', newTheme)
  }

  return { theme, isDark, toggleTheme }
}
