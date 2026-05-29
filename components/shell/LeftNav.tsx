'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { BarChart2, Layers, Settings } from 'lucide-react'
import type { ComponentType, ReactElement } from 'react'

interface NavItem {
  label: string
  segment: string
  Icon:  ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Panoramica', segment: 'overview',  Icon: BarChart2 },
  { label: 'Gruppi',     segment: 'groups',    Icon: Layers },
  { label: 'Impostazioni', segment: 'settings', Icon: Settings },
]

export function LeftNav(): ReactElement {
  const pathname  = usePathname()
  const params    = useParams()
  const rawId     = params['projectId']
  const projectId = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '')

  return (
    <nav
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-background p-3"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ label, segment, Icon }) => {
        const href   = projectId !== '' ? `/p/${projectId}/${segment}` : '#'
        const active = pathname.startsWith(`/p/${projectId}/${segment}`) && projectId !== ''
        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            aria-disabled={projectId === ''}
            className={[
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              projectId === ''
                ? 'pointer-events-none text-muted-foreground/40'
                : active
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
