'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, Layers, Settings } from 'lucide-react'
import type { ComponentType, ReactElement } from 'react'

interface NavItem {
  label: string
  href:  string
  Icon:  ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/app/overview', Icon: BarChart2 },
  { label: 'Groups',   href: '/app/groups',   Icon: Layers },
  { label: 'Settings', href: '/app/settings', Icon: Settings },
]

export function LeftNav(): ReactElement {
  const pathname = usePathname()

  return (
    <nav
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-background p-3"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ label, href, Icon }) => {
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            ].join(' ')}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
