'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface FacetSelectProps<T extends string> {
  label: string
  options: readonly T[]
  value: T[] | null | undefined
  onChange: (value: T[] | null) => void
  renderOption?: (value: T) => string
}

export function FacetSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption = (v) => v,
}: FacetSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = value ?? []

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  function toggle(option: T) {
    const next = selected.includes(option)
      ? selected.filter((s) => s !== option)
      : [...selected, option]
    onChange(next.length > 0 ? next : null)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-border"
      >
        <span className="text-muted-foreground">{label}</span>
        {selected.length > 0 && (
          <span className="rounded bg-foreground px-1 text-xs font-semibold text-background">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-1 min-w-max rounded-md border border-border bg-background py-1 shadow-md"
        >
          {options.map((opt) => {
            const checked = selected.includes(opt)
            return (
              <li
                key={opt}
                role="option"
                aria-selected={checked}
                tabIndex={0}
                onClick={() => toggle(opt)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(opt)
                  }
                }}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
              >
                <span
                  className={[
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-foreground bg-foreground' : 'border-border',
                  ].join(' ')}
                >
                  {checked && <Check className="h-2.5 w-2.5 text-background" />}
                </span>
                {renderOption(opt)}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
