import type { RecommendedAction } from '@/src/contracts/types/domain'
import { ActionTag } from '@/components/cells/ActionTag'

interface Props {
  action: RecommendedAction
}

const ACTION_DESCRIPTIONS: Record<RecommendedAction, string> = {
  consolidate_301:
    'Consolida: esegui un redirect 301 dalla pagina debole verso quella forte. Concentra tutti i segnali SEO su un\'unica URL eliminando la competizione interna.',
  differentiate_variant_onpage:
    'Differenzia on-page la variante: questa è una variante base. Modifica i segnali on-page della pagina personalizzata (titolo, H1, contenuto) per distinguerla chiaramente dall\'originale.',
  despine_blog_to_collection:
    'Scollega il blog dalla raccolta: trasforma o ridestina il contenuto del blog per evitare la competizione diretta con la pagina raccolta. Considera di cambiare l\'angolo editoriale.',
  reposition_collection_strengthen_blog:
    'Riposiziona la raccolta e rafforza il blog: aggiusta il focus commerciale della pagina raccolta e potenzia il blog con contenuti informativi unici per servire intent diversi.',
  interlink_blog_to_collection:
    'Collega il blog alla raccolta: aggiungi link interni rilevanti dal blog verso la raccolta. Direziona l\'autorità di link verso la pagina commerciale e chiarisci la gerarchia al crawler.',
  reduce_blog_overlap_or_canonical:
    'Riduci la sovrapposizione del blog o usa canonical: limita la sovrapposizione di contenuto tra i blog, oppure imposta un tag canonical sul blog meno rilevante verso quello principale o la raccolta.',
  consolidate_blog_cluster:
    'Consolida il cluster blog: unisci i post blog simili in un unico contenuto pillar più completo. Concentra i segnali di autorità su un\'unica risorsa per dominare l\'intent informativo.',
  differentiate_onpage:
    'Differenzia on-page: modifica i segnali on-page delle pagine che competono (titolo, meta description, H1, contenuto) per servire intent distinti e ridurre la sovrapposizione semantica.',
}

export function ActionPanel({ action }: Props) {
  return (
    <section className="rounded-lg border p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Azione raccomandata
        </h2>
        <ActionTag action={action} />
      </div>
      <p className="text-sm leading-relaxed">{ACTION_DESCRIPTIONS[action]}</p>
    </section>
  )
}
