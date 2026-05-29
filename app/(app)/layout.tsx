import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Providers } from '@/lib/query-client'
import { LeftNav } from '@/components/shell/LeftNav'
import { TopBar } from '@/components/shell/TopBar'
import { TopBarSlotProvider } from '@/components/shell/TopBarSlotContext'
import type { ReactElement, ReactNode } from 'react'

export default function AppLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <Providers>
      <NuqsAdapter>
        <TopBarSlotProvider>
          <div className="flex h-full flex-col bg-background text-foreground">
            <TopBar />
            <div className="flex flex-1 overflow-hidden">
              <LeftNav />
              <main className="flex-1 overflow-auto p-6">
                {children}
              </main>
            </div>
          </div>
        </TopBarSlotProvider>
      </NuqsAdapter>
    </Providers>
  )
}
