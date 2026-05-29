import type { GroupMemberDTO } from '@/src/contracts/types/entities'
import type { PageType } from '@/src/contracts/types/domain'
import { MetricCell } from '@/components/cells/MetricCell'

interface Props {
  members: GroupMemberDTO[]
  winnerPage: string | null
  dominantPage: string | null
}

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  collection: 'Raccolta',
  blog:       'Blog',
  product:    'Prodotto',
  other:      'Altro',
  unknown:    'Sconosciuto',
}

const POS_FMT = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })

export function MemberCompare({ members, winnerPage, dominantPage }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Pagine in competizione
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" role="grid">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Pagina</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-right font-medium">Click</th>
              <th className="px-3 py-2 text-right font-medium">Impressioni</th>
              <th className="px-3 py-2 text-right font-medium">Posizione</th>
              <th className="px-3 py-2 text-left font-medium">Ruolo</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isWinner   = m.page === winnerPage
              const isDominant = m.page === dominantPage
              return (
                <tr key={m.page} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs" title={m.page}>
                    {m.page}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {PAGE_TYPE_LABELS[m.pageType]}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.clicks} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.impressions} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {POS_FMT.format(m.position)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {isWinner && (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-primary text-primary-foreground">
                          [WINNER]
                        </span>
                      )}
                      {isDominant && (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground">
                          [DOMINANT]
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
