import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Providers } from '@/lib/query-client'
import { LeftNav } from '@/components/shell/LeftNav'
import { TopBar } from '@/components/shell/TopBar'
import type { ReactElement, ReactNode } from 'react'

export default function AppLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <Providers>
      <NuqsAdapter>
        <div className="flex h-full flex-col bg-background text-foreground">
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            <LeftNav />
            <main className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </div>
        </div>
      </NuqsAdapter>
    </Providers>
  )
}
