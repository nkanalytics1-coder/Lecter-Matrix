# BigQuery Design — Lecter-Matrix (v2)

> **La sezione "Architettura ibrida BQ + Postgres" del documento v1 è OBSOLETA e sostituita
> integralmente da questo documento.** Le decisioni qui override quelle implicite nel codice;
> dove conflitto con CLAUDE.md, documentare l'assunzione e scegliere la via a minor debito.

---

## 0. Principi architetturali (override su v1)

Approvati da NK. Override su ogni assunzione precedente.

| # | Principio | Implicazione operativa |
|---|---|---|
| 1 | **Tutto in BigQuery** | Nessun Postgres / Supabase. `project`, `gsc_connection`, `cannibalization_group`, `cannibalization_member`, `group_state`, `analysis_run` vivono in BQ. Supabase viene dismesso. |
| 2 | **Analisi on-demand, non cron** | L'utente clicca "Esegui analisi". `app/api/cron/tick.ts` e le dichiarazioni cron in `vercel.json` vengono **rimossi**. Nessun sync continuo, nessun backfill periodico. |
| 3 | **Dati GSC transitori** | Durante l'analisi i dati grezzi GSC vivono in `gsc_metric_temp_{run_id}`. Al termine (successo o errore) la tabella viene droppata. Nessuna `gsc_metric` persistente. |
| 4 | **Analisi atomica, non versionata** | Ogni analisi sovrascrive i risultati precedenti del progetto (DELETE + INSERT). Nessuno storico di run multiple per progetto. `group_state` sopravvive al re-run: è il triage manuale dell'utente, keyed sul `group_key` deterministico. |
| 5 | **Job lungo accettabile** | NK accetta che un'analisi su proprietà grandi (es. Corriere) possa richiedere ore. Il job pesante gira in Google Cloud Run Jobs, non in Vercel. |

---

## 1. Dataset BigQuery

```
GCP project:  lecter-matrix-prod
Dataset:      lecter
Location:     europe-west1    ← GDPR; i dati GSC riguardano utenti europei
```

Un unico dataset per tutte le tabelle (persistenti e transitorie). Le tabelle transitorie si distinguono per prefisso `gsc_metric_temp_`.

---

## 2. Tabelle persistenti — DDL completo

### 2.1 `project`

Una riga per progetto (≤ 1 000 righe nel lifetime del tool). Nessun partitioning necessario.

```sql
CREATE TABLE `lecter-matrix-prod.lecter.project` (
  id          STRING    NOT NULL,
  name        STRING    NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL
)
CLUSTER BY id
OPTIONS (description = 'Project metadata. Small table; no partitioning needed.');
```

### 2.2 `gsc_connection`

Una riga per progetto. I token OAuth sono cifrati con AES-256 (`TOKEN_ENC_KEY`) prima di essere scritti. BQ non ha RLS: il token è illeggibile senza la chiave, che non transita mai in BQ.

```sql
CREATE TABLE `lecter-matrix-prod.lecter.gsc_connection` (
  project_id              STRING    NOT NULL,
  status                  STRING    NOT NULL,   -- connected | revoked | error
  access_token_enc        STRING,               -- null se status != connected
  refresh_token_enc       STRING,
  access_token_expires_at STRING,               -- ISO 8601, nullable
  scopes                  STRING,               -- space-separated
  connected_at            TIMESTAMP NOT NULL,
  updated_at              TIMESTAMP NOT NULL
)
CLUSTER BY project_id
OPTIONS (description = 'GSC OAuth credentials per project. Tokens AES-256-encrypted before write.');
```

### 2.3 `analysis_run`

Una riga per progetto per run. Sovrascritta (DELETE + INSERT) quando si avvia una nuova analisi sullo stesso progetto. La partition expiration di 30 giorni copre lo storico minimo di debugging.

```sql
CREATE TABLE `lecter-matrix-prod.lecter.analysis_run` (
  run_id          STRING    NOT NULL,
  project_id      STRING    NOT NULL,
  status          STRING    NOT NULL,   -- queued | running | completed | failed
  progress_step   STRING,               -- es. "fetching day 23/90" | "running detection"
  started_at      TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP,
  error           STRING,
  rows_fetched    INT64,
  groups_found    INT64
)
PARTITION BY DATE(started_at)
CLUSTER BY project_id
OPTIONS (
  partition_expiration_days = 30,
  description = 'One row per analysis run. DELETE + INSERT on new run for same project.'
);
```

**Invariante:** per ogni `project_id` esiste al più una riga con `status IN (''queued'', ''running'')` in un dato momento. Il Cloud Run Job controlla questa invariante prima di avviarsi.

### 2.4 `cannibalization_group`

Risultati della detection. Completamente sovrascritti a ogni analisi (DELETE WHERE project_id + INSERT).

```sql
CREATE TABLE `lecter-matrix-prod.lecter.cannibalization_group` (
  project_id          STRING    NOT NULL,
  group_key           STRING    NOT NULL,   -- hash deterministico delle pagine membro (stable cross-run)
  run_id              STRING    NOT NULL,
  query_norm          STRING    NOT NULL,
  severity            STRING    NOT NULL,   -- low | medium | high | critical
  cann_type           STRING    NOT NULL,
  winner_page         STRING,
  should_win_page     STRING,
  inversion           BOOL      NOT NULL,
  benign              BOOL      NOT NULL,
  recommended_action  STRING    NOT NULL,
  total_clicks        INT64     NOT NULL,
  total_impressions   INT64     NOT NULL,
  detected_at         TIMESTAMP NOT NULL
)
CLUSTER BY project_id, group_key
OPTIONS (description = 'Cannibalization groups. Fully replaced on each analysis run per project.');
```

### 2.5 `cannibalization_member`

```sql
CREATE TABLE `lecter-matrix-prod.lecter.cannibalization_member` (
  project_id        STRING    NOT NULL,
  group_key         STRING    NOT NULL,
  run_id            STRING    NOT NULL,
  page              STRING    NOT NULL,
  page_type         STRING    NOT NULL,
  clicks            INT64     NOT NULL,
  impressions       INT64     NOT NULL,
  weighted_position FLOAT64   NOT NULL,
  is_winner         BOOL      NOT NULL
)
CLUSTER BY project_id, group_key
OPTIONS (description = 'Members of each cannibalization group. Fully replaced on each analysis run per project.');
```

### 2.6 `group_state`

Triage manuale dell'utente. **Non** sovrascritta a ogni analisi. Il `group_key` è deterministico (hash delle pagine membro ordinate): se la detection produce lo stesso gruppo in due run diversi, lo stato sopravvive. Righe orfane (group_key scomparso dalla detection) vengono pulite dal job al termine di ogni run.

```sql
CREATE TABLE `lecter-matrix-prod.lecter.group_state` (
  project_id  STRING    NOT NULL,
  group_key   STRING    NOT NULL,
  state       STRING    NOT NULL,   -- active | suppressed | benign
  note        STRING,
  updated_at  TIMESTAMP NOT NULL
)
CLUSTER BY project_id, group_key
OPTIONS (description = 'User triage state per group. Survives re-runs; orphaned keys cleaned up post-run.');
```

---

## 3. Tabella transitoria: `gsc_metric_temp_{run_id}`

Creata all'inizio di ogni analisi, droppata esplicitamente al termine. Se il job crasha, BQ la elimina automaticamente dopo 24h via `expiration_timestamp`.

```sql
CREATE TABLE `lecter-matrix-prod.lecter.gsc_metric_temp_{run_id}` (
  query_norm   STRING    NOT NULL,
  page         STRING    NOT NULL,
  page_type    STRING    NOT NULL,
  date         DATE      NOT NULL,
  clicks       INT64     NOT NULL,
  impressions  INT64     NOT NULL,
  position     FLOAT64   NOT NULL
)
PARTITION BY date
CLUSTER BY query_norm
OPTIONS (
  expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR),
  description = 'Transient: 90-day GSC raw data for one analysis run. Auto-deleted after 24h if not dropped explicitly.'
);
```

**Naming:** `gsc_metric_temp_` + UUID senza trattini. Esempio: `gsc_metric_temp_a1b2c3d4e5f6a1b2`.

**Lifecycle:**
1. Il Cloud Run Job crea la tabella con `expiration_timestamp = now + 24h`.
2. Carica i dati GSC via BQ Load Job (gratuito; non conteggiato come query billable).
3. Esegue la query di detection sulla tabella.
4. Scrive gruppi + membri nelle tabelle persistenti.
5. Droppa esplicitamente la tabella (`DROP TABLE`).
6. Se il job crasha a qualsiasi step → la tabella viene eliminata da BQ dopo 24h. Nessun intervento manuale.

---

## 4. Architettura di esecuzione: il job lungo

### Il problema

Vercel funzioni serverless hanno timeout:
- Hobby/Free: **10 secondi**
- Pro: **300 secondi** (5 minuti)

Un'analisi su Corriere (fetch GSC + load BQ + detection + write) può richiedere ore. Nessun piano Vercel è sufficiente per il job pesante.

### Soluzione: Google Cloud Run Jobs

Cloud Run Jobs esegue container a completamento (non un HTTP server continuo).

| Caratteristica | Valore |
|---|---|
| Timeout massimo | 24 ore |
| Free tier | 180 000 vCPU-s + 360 000 GiB-s / mese (≈ 50 ore di 1 vCPU per mese) |
| Trigger | HTTP via Cloud Run Admin API — chiamata autenticata da Vercel |
| Costo sopra il free tier | ~$0,0002/vCPU-s (trascurabile per uso agency) |

### Flusso completo

```
User → POST /api/projects/{id}/analysis
  1. Genera run_id (UUID)
  2. Controlla che non ci sia già un run queued/running per il progetto
  3. Scrive analysis_run in BQ { status: queued }
  4. Chiama Cloud Run Admin API:
     POST https://run.googleapis.com/v2/projects/{gcp_project}/locations/{region}/jobs/{job_name}:run
     Body: { overrides: { containerOverrides: [{ env: [{ run_id }, { project_id }] }] } }
  5. Risponde 202 { run_id }

Cloud Run Job (asincrono, ore):
  1. Aggiorna analysis_run → status: running
  2. Legge gsc_connection → decifra refresh token → ottiene access token GSC
  3. Crea gsc_metric_temp_{run_id} in BQ
  4. Per ogni giorno in [today-90 .. today]:
       Fetch GSC API (dimensioni: query, page, date; paginated 25K righe/call)
       Normalizza query (normalizeQuery), classifica pagina (classifyPage)
       Accumula batch → BQ Load Job sulla partizione corrispondente
       Aggiorna analysis_run.progress_step → "fetching day N/90"
  5. Query di detection sulla temp table (→ result set in memoria)
  6. Scoring TypeScript (immutato: scoring.ts, action-table.ts)
  7. BQ DML:
       DELETE cannibalization_group  WHERE project_id = @project_id
       DELETE cannibalization_member WHERE project_id = @project_id
       INSERT INTO cannibalization_group  … (batch)
       INSERT INTO cannibalization_member … (batch)
       DELETE group_state WHERE project_id = @project_id
         AND group_key NOT IN (SELECT group_key FROM cannibalization_group WHERE project_id = @project_id)
  8. DROP TABLE gsc_metric_temp_{run_id}
  9. Aggiorna analysis_run → status: completed, completed_at, groups_found

In caso di errore (in un blocco finally):
  → Aggiorna analysis_run → status: failed, error: message
  → DROP TABLE gsc_metric_temp_{run_id} se esiste

UI polling → GET /api/projects/{id}/analysis/status
  → Legge analysis_run da BQ (riga più recente per project_id)
  → { status, progress_step, started_at, completed_at?, error? }
  → Il client fa polling ogni 10s mentre status ∈ {queued, running}; si ferma su completed/failed
```

### Vercel Free vs Vercel Pro

| Piano | Timeout | Impatto sull'architettura |
|---|---|---|
| Hobby/Free (10s) | Cloud Run è **obbligatorio**. Vercel gestisce solo trigger (< 1s) e status polling (< 1s). | — |
| Pro (300s) | Come sopra. Le proprietà piccole (< 300 chiamate API GSC a ~1s/call) potrebbero girare interamente in Vercel, ma Cloud Run è più consistente e non vale avere due path di esecuzione. | Nessun cambio architetturale. |

**Raccomandazione:** Cloud Run Jobs sempre, indipendentemente dal piano Vercel. Il costo Cloud Run è zero per uso agency (dentro il free tier). Passare a Vercel Pro non modifica l'architettura; lo si valuta per altri motivi (più build minutes, preview env, ecc.).

---

## 5. Fetch GSC: strategia e quota

### Quota default GSC API

La Search Analytics API ha un limite di **1 200 richieste per GCP project per giorno** (quota predefinita). Ogni chiamata paginata = 1 richiesta.

### Stima chiamate per analisi (fetch giornaliero con dimensioni `[query, page, date]`)

| Proprietà | Righe/giorno stimate | Paginate API/giorno (25K rig/call) | 90 giorni totale |
|---|---|---|---|
| Piccola (< 50K rig/giorno) | 50K | 2 | **180** — dentro quota in 1 giorno |
| Media (es. Donna Moderna 500K) | 500K | 20 | **1 800** — 2 giorni di quota |
| Grande (es. Corriere 3M) | 3M | 120 | **10 800** — 9 giorni di quota senza quota increase |

### Strategie per proprietà grandi

**Opzione A — Quota increase (raccomandata per property enterprise):**
Richiedere aumento via Google Cloud Console (`searchconsole.googleapis.com/data_requests`).
Google concede tipicamente 10 000–50 000 req/giorno per uso legittimo di terze parti.
Con 10 000/giorno: Corriere in 2 giorni.

**Opzione B — Fetch aggregato (fallback senza quota increase):**
Dimensioni: `[query, page]` senza `date`. Una sola serie di chiamate per la finestra 90 giorni.
GSC restituisce dati già aggregati su 90 giorni; la `position` è la media di Google (non impression-weighted nel senso del calcolo corrente).
**Trade-off:** deviazione dalla regola CLAUDE.md "impression-weighted position". NK deve accettare esplicitamente. La deviazione pratica è ridotta (Google aggrega già per volume di query), ma è una differenza dall'algoritmo corrente.
Con questa opzione la temp table non ha colonna `date`; la query di detection diventa una SELECT senza GROUP BY.

Il Cloud Run Job supporta entrambe le strategie tramite un parametro (`FETCH_STRATEGY=daily|aggregated`).

### Rate limiting nel job

Indipendentemente dalla quota, il job implementa:
- Backoff esponenziale su 429.
- Rispetta l'header `Retry-After` se presente.
- Checkpoint in `analysis_run.progress_step` (ultimo giorno fetched): in caso di quota esaurita il job può riprendere dal checkpoint a nuova invocazione.

---

## 6. Query di detection sulla tabella transitoria

### Con fetch giornaliero (raccomandato)

```sql
SELECT
  query_norm,
  page,
  page_type,
  CAST(SUM(clicks) AS INT64)                                  AS total_clicks,
  CAST(SUM(impressions) AS INT64)                             AS total_impressions,
  SUM(position * impressions) / NULLIF(SUM(impressions), 0)  AS weighted_position
FROM `lecter-matrix-prod.lecter.gsc_metric_temp_{run_id}`
WHERE impressions >= 1
GROUP BY query_norm, page, page_type
```

- Nessun filtro `project_id`: la temp table è già scoped al run (e quindi al progetto).
- Nessun filtro `date`: la temp table contiene esattamente i 90 giorni dell'analisi.
- Partition pruning non si applica (tutte le partizioni sono nell'intervallo). Il clustering su `query_norm` riduce i bytes letti all'interno di ogni partizione.
- Il result set entra in memoria nel Cloud Run Job e viene passato allo scoring TypeScript invariato.

### Con fetch aggregato (fallback)

La temp table non ha colonna `date`. La SELECT diventa:

```sql
SELECT
  query_norm,
  page,
  page_type,
  clicks,
  impressions,
  position   -- GSC native 90-day average; non impression-weighted nel senso corrente
FROM `lecter-matrix-prod.lecter.gsc_metric_temp_{run_id}`
WHERE impressions >= 1
```

Nessun GROUP BY (dati già aggregati da GSC).

---

## 7. Stima costi

### Modello di utilizzo

Stima realistica agenzia: **20–50 analisi al mese** su proprietà miste.

### Storage (tabelle persistenti)

Tutte le tabelle persistenti (project, connection, groups, state, run) hanno dimensione totale stimata < 100 MB. Costo: **< $0,01/mese**.

### Query di detection (costo dominante)

BQ Load Job (scrittura temp table): gratuito.

Con **fetch giornaliero** (90 giorni, 6 colonne lette):

| Proprietà | Righe nella temp table | GB scansionati | Costo per analisi |
|---|---|---|---|
| Piccola | 4,5 M | 0,45 GB | $0,002 |
| Media (Donna Moderna 500K rig/giorno) | 45 M | 4,5 GB | $0,022 |
| Grande (Corriere 3M rig/giorno) | 270 M | 27 GB | $0,135 |

Con **fetch aggregato** (no date): righe ≈ unique (query, page) pairs. Per Corriere ~1–2 M righe → ~200 MB → **$0,001 per analisi**. Virtualmente gratuito.

### Free tier

BQ include 1 TB di query gratuite al mese.

Scenario: 50 analisi/mese, mix proprietà (fetch giornaliero):
- 5 analisi su grandi (Corriere): 5 × 27 GB = 135 GB
- 20 analisi su medie: 20 × 4,5 GB = 90 GB
- 25 analisi su piccole: 25 × 0,45 GB = 11 GB
- **Totale: ~236 GB/mese → ampiamente dentro il free tier (1 024 GB)**

### Break-even vs Supabase Pro

- Supabase Pro: $25/mese (8 GB Postgres inclusi).
- BQ con questo modello: $0–$5/mese (quasi tutto nel free tier).
- **BQ è strutturalmente più economico.** Il break-even (BQ supera i $25) si raggiunge solo con centinaia di analisi/mese su proprietà grandi (> 185 analisi di Corriere al mese prima che la query cost superi i $25 sopra il free tier).

---

## 8. Dismissione Postgres / Supabase

I dati correnti in Supabase sono **dati di test**. Non è necessaria nessuna migrazione dati.

Procedura:
1. Confermare con NK che non ci siano dati di produzione reali in Supabase.
2. Eliminare il progetto Supabase (o lasciarlo scadere sul piano free).
3. Rimuovere le variabili d'ambiente Supabase da Vercel (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`).
4. Rimuovere `@supabase/supabase-js` e `postgres` dal `package.json`.
5. Archiviare `supabase/migrations/` in un branch separato (referenza storica), poi rimuovere dal main.

---

## 9. Variabili d'ambiente

### Nuove

| Variabile | Esempio | Note |
|---|---|---|
| `GCP_PROJECT_ID` | `lecter-matrix-prod` | ID progetto Google Cloud |
| `BQ_DATASET` | `lecter` | Nome dataset BQ |
| `BQ_LOCATION` | `europe-west1` | Coerente con la location del dataset |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",...}` | JSON completo del service account; su Vercel come env var encrypted at rest |
| `CLOUD_RUN_JOB_NAME` | `lecter-analysis-worker` | Nome del Cloud Run Job |
| `CLOUD_RUN_REGION` | `europe-west1` | Region del job (stessa del dataset per latenza minima) |

### Da rimuovere

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

`CRON_SECRET` — da rimuovere se il cron endpoint viene eliminato; da tenere se viene stubbato come risposta 204 vuota.

### Invariate

`TOKEN_ENC_KEY`, `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`.

### Service account permissions minime

- `roles/bigquery.dataEditor` sul dataset `lecter`
- `roles/bigquery.jobUser` sul progetto GCP
- `roles/run.invoker` sul job `lecter-analysis-worker` (per triggerare il job da Vercel)

---

## 10. File del progetto da toccare

### Rimossi

| File / configurazione | Azione |
|---|---|
| `app/api/cron/tick.ts` | **Rimuovere**. Il cron non ha più responsabilità. Se `vercel.json` lo dichiara, rimuovere la schedule; il file può diventare un stub che risponde 204 per evitare 404 durante il deploy transitorio. |
| Sezione `crons` in `vercel.json` | **Rimuovere** le schedule. |

### Da riscrivere completamente

| File | Motivazione |
|---|---|
| `server/db/client.ts` | Sostituire il client Supabase/Postgres con `@google-cloud/bigquery`; esportare `bqClient()`. |
| `server/repositories/project.repo.ts` | BQ DML (parametri nominati `@param`, non posizionali `$1`). |
| `server/repositories/connection.repo.ts` | BQ DML. |
| `server/repositories/group.repo.ts` | BQ DML; gestire il DELETE + INSERT su `cannibalization_group/member`. |
| `server/ingest/persist.ts` | Diventa `server/ingest/load-to-bq.ts`: scrive batch su `gsc_metric_temp_{run_id}` via BQ Load Job. |
| `server/engine/detect.ts` | Query su `gsc_metric_temp_{run_id}` invece di `gsc_metric`. Parametri BQ nominati. |

### Nuovi

| File / artefatto | Scopo |
|---|---|
| `server/repositories/analysis-run.repo.ts` | CRUD su `analysis_run` in BQ. |
| `app/api/projects/[id]/analysis/route.ts` | POST: controlla run in corso → scrive analysis_run → triggera Cloud Run Job → 202. |
| `app/api/projects/[id]/analysis/status/route.ts` | GET: legge analysis_run da BQ → restituisce `{ status, progress_step, started_at, completed_at, error }`. |
| `worker/` (directory separata o repo) | Codice del Cloud Run Job: orchestrazione del pipeline completo (fetch → load → detect → write → cleanup). |

### Non toccare

`src/contracts/`, `lib/`, `test/` (adattare i test di integration al nuovo backend). La logica di scoring (`server/engine/scoring.ts`, `server/engine/action-table.ts`) rimane invariata.

---

## 11. Frontend: cosa cambia

Visivamente tutto rimane identico: selettore progetto, tabella gruppi con keyset pagination, filtri URL, drill.

**Due aggiunte:**

**1. Bottone "Esegui analisi"** — nel pannello del progetto o nella toolbar della tabella gruppi.
- Chiama `POST /api/projects/{id}/analysis`.
- Se c'è già un run in corso: mostra messaggio "Analisi già in esecuzione".
- Risposta 202 → il bottone diventa disabilitato, compare il banner di stato.

**2. Banner di stato analisi corrente** — in cima alla pagina del progetto.

| Stato | Testo mostrato |
|---|---|
| `queued` | "Analisi in coda…" |
| `running` + `progress_step` | es. "Recupero dati: giorno 23/90" |
| `completed` | Banner scompare (o chip: "Ultima analisi: 5 giu 2026, 14:32") |
| `failed` | Banner rosso: messaggio di errore + bottone "Riprova" |

Il polling avviene tramite TanStack Query su `/api/projects/{id}/analysis/status` ogni 10 secondi (`refetchInterval`) quando `status ∈ { queued, running }`. Il polling si ferma su `completed` o `failed`. Nessun websocket, nessun SSE.
