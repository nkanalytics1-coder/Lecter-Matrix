interface InversionFlagProps {
  inversion: boolean
}

export function InversionFlag({ inversion }: InversionFlagProps) {
  if (!inversion) return null
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
      Inv
    </span>
  )
}
