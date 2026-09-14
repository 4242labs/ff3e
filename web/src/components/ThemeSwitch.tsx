import { useEffect, useState } from 'react'

import {
  ThemeSwitch as CanonicalThemeSwitch,
  type ThemeSwitchTheme,
} from '@/components/ui/theme-switch'

const STORAGE_KEY = 'entropy-theme'

function readInitialTheme(): ThemeSwitchTheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies FF3E persistence while the adopted component owns visuals and ARIA. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeSwitchTheme>(() =>
    typeof window === 'undefined' ? 'light' : readInitialTheme(),
  )

  useEffect(() => {
    document.body.classList.toggle('theme-dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return (
    <CanonicalThemeSwitch
      theme={theme}
      setTheme={setTheme}
    />
  )
}
