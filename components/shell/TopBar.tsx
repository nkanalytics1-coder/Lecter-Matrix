'use client'

import type { ReactElement } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { useTopBarSlot } from './TopBarSlotContext'

export function TopBar(): ReactElement {
  const { slot } = useTopBarSlot()
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      <span className="text-sm font-semibold text-foreground">Lecter Matrix</span>
      {slot !== null && (
        <div className="flex items-center gap-3 border-l border-border pl-4">
          {slot}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  )
}
