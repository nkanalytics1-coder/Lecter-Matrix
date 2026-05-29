import type { ReactElement } from 'react'

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function OverviewLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-36" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="flex items-end gap-2">
          <Skeleton className="h-[60px] flex-1" />
          <Skeleton className="h-[40px] flex-1" />
          <Skeleton className="h-[80px] flex-1" />
          <Skeleton className="h-[30px] flex-1" />
          <Skeleton className="h-[55px] flex-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1].map(i => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-28" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>
    </div>
  )
}
