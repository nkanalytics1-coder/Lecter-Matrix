'use client'

interface RangeInputProps {
  label: string
  value: number | null | undefined
  onChange: (value: number | null) => void
  min?: number
  max?: number
}

export function RangeInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: RangeInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.trim()
    if (raw === '') {
      onChange(null)
      return
    }
    const n = Number(raw)
    if (Number.isInteger(n) && n >= min && n <= max) onChange(n)
  }

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={handleChange}
        placeholder="—"
        className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-border"
      />
    </label>
  )
}
