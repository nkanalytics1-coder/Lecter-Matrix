import type { ReactElement } from 'react'

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

export default function SettingsLoading(): ReactElement {
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-4">
        <Skeleton className="h-3 w-36" />
        <FieldSkeleton />
        <FieldSkeleton />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-16" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Skeleton className="h-3 w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3, 4].map(i => <FieldSkeleton key={i} />)}
        </div>
        <FieldSkeleton />
        <FieldSkeleton />
      </section>

      <Skeleton className="h-9 w-36 self-start" />

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <Skeleton className="h-3 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </section>
    </div>
  )
}
