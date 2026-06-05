import type { ReactElement } from 'react'

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function GroupDetailLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-6 w-48" />
      </div>

      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-5 w-20 rounded-full" />)}
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-5 w-32" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 border-b border-border px-4 py-4 last:border-0">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-12 self-center" />
            <Skeleton className="h-4 w-12 self-center" />
            <Skeleton className="h-4 w-12 self-center" />
            <Skeleton className="h-5 w-16 self-center rounded-full" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border p-4">
        <Skeleton className="mb-4 h-5 w-36" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
        <Skeleton className="mt-4 h-9 w-32" />
      </div>
    </div>
  )
}
