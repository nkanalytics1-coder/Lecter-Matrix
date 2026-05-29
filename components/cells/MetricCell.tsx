const FMT = new Intl.NumberFormat('it-IT')

interface MetricCellProps {
  value: number | null | undefined
}

export function MetricCell({ value }: MetricCellProps) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return <span className="tabular-nums">{FMT.format(value)}</span>
}
