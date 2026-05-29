import type { ReactElement } from 'react'
import { ThemeToggle } from './ThemeToggle'

interface TopBarProps {
  projectName?: string
}

export function TopBar({ projectName = 'Lecter Matrix' }: TopBarProps): ReactElement {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      <span className="text-sm font-medium text-foreground truncate">
        {projectName}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  )
}
