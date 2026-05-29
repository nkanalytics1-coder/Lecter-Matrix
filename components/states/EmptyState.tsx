import type { ReactElement, ReactNode } from 'react'

interface Cta {
  label: string
  onClick?: () => void
  href?: string
}

interface Props {
  icon: ReactNode
  title: string
  description: string
  cta?: Cta
}

export function EmptyState({ icon, title, description, cta }: Props): ReactElement {
  const ctaClass =
    'mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90'

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-muted-foreground [&_svg]:h-10 [&_svg]:w-10">{icon}</div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      </div>
      {cta !== undefined && (
        cta.href !== undefined ? (
          <a href={cta.href} className={ctaClass}>{cta.label}</a>
        ) : (
          <button type="button" onClick={cta.onClick} className={ctaClass}>{cta.label}</button>
        )
      )}
    </div>
  )
}
