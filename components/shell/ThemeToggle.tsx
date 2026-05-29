'use client'

import { useEffect, useState, type ReactElement } from 'react'
import { Moon, Sun } from 'lucide-react'

const STORAGE_KEY = 'lm-theme'

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
}

export function ThemeToggle(): ReactElement {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    const isDark =
      saved !== null
        ? saved === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches
    setDark(isDark)
    applyTheme(isDark)
  }, [])

  function toggle(): void {
    const next = !dark
    setDark(next)
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
    applyTheme(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}
