# BigQuery — Guida per il proprietario (v2)

**A chi serve questo doc:** chi deve capire cosa cambia con il nuovo design, cosa configurare,
quanto costa e quali limiti esistono — senza leggere il documento tecnico.

> **Questo documento sostituisce la versione precedente.** Il design precedente prevedeva
> un'architettura ibrida BigQuery + Postgres. Quella strada è abbandonata: tutto va in BigQuery.

---

## Cosa cambia rispetto a prima

Il design precedente:
- Salvava i dati GSC su BigQuery ogni giorno in automatico (cron notturno).
- Teneva project, credenziali OAuth, risultati della detection su Postgres (Supabase).
- Era un sistema sempre attivo, con sync continuo.

Il nuovo design:
- **Non c'è più nessun cron.** L'analisi parte quando tu clicchi "Esegui analisi".
- **Tutto va in BigQuery**, inclusi project, credenziali OAuth, gruppi di cannibalizzazione. Supabase viene spento.
- I dati grezzi GSC (le righe fetch-ate dalla API di Google) non vengono mai salvati in modo permanente: vivono in una tabella temporanea durante l'analisi, poi vengono eliminati. L'unica cosa che resta sono i risultati (i gruppi di cannibalizzazione).

---

## Come funziona la nuova analisi

1. **Clicchi "Esegui analisi"** su un progetto.
2. L'app avvia un job in background su Google Cloud e risponde subito con "Analisi avviata".
3. Il job (che gira su Google Cloud, non su Vercel) fa tutto il lavoro:
   - Chiede 90 giorni di dati a Google Search Console, giorno per giorno.
   - Salva i dati grezzi in una tabella temporanea su BigQuery.
   - Esegue l'analisi di cannibalizzazione.
   - Scrive i risultati (i gruppi) su BigQuery.
   - Cancella la tabella temporanea.
4. **Il job può durare ore.** Per proprietà grandi come Corriere, il fetch da GSC è lento per via dei limiti di chiamate API di Google. Non devi aspettare davanti al browser.
5. Quando torni, la pagina mostra l'esito: i gruppi aggiornati oppure un messaggio di errore.

**Se rifai l'analisi sullo stesso progetto,** i risultati precedenti vengono sovrascritti. Non c'è uno storico di analisi multiple: c'è sempre solo l'ultima.

---

## Cosa vedi nell'app durante l'analisi

Nella pagina del progetto compare un banner che aggiorna il progresso in tempo reale:

- **"In coda…"** — il job è stato avviato ma non ancora partito.
- **"Recupero dati: giorno 23/90"** — sta scaricando i dati da GSC.
- **"Esecuzione detection"** — sta analizzando i dati.
- **"Scrittura risultati"** — sta salvando i gruppi.
- Quando finisce, il banner scompare e la tabella si aggiorna.
- Se qualcosa va storto: banner rosso con il messaggio di errore e un bottone "Riprova".

Il resto dell'app (selettore progetto, filtri, drill) rimane identico a prima.

---

## Cosa configurare su Google Cloud (una volta sola)

Alcune di queste cose le hai già fatte per la connessione GSC. Dove indicato, è roba nuova.

**BigQuery e service account (già fatto o da fare):**
- [ ] Vai su [console.cloud.google.com](https://console.cloud.google.com) → stesso progetto che usi per OAuth GSC.
- [ ] Abilita l'API **BigQuery API** (se non l'hai già fatto).
- [ ] Vai su *BigQuery → Esplora* → crea un dataset chiamato `lecter`, region **europe-west1**.
- [ ] Vai su *IAM e Amministrazione → Account di servizio* → crea (o riusa) un account `lecter-matrix-bq`.
- [ ] Assegna i ruoli: **Editor dati BigQuery** + **Utente lavori BigQuery**.
- [ ] Genera una chiave JSON per quell'account → scaricala.

**Cloud Run Job (nuovo — necessario per il job lungo):**
- [ ] Vai su *Cloud Run → Jobs* → crea un job chiamato `lecter-analysis-worker`.
- [ ] Carica il container del worker (fornito dagli sviluppatori come immagine Docker).
- [ ] Assegna il service account `lecter-matrix-bq` al job.
- [ ] Aggiungi al service account il ruolo **Invoker Cloud Run** sul job stesso.

---

## Variabili d'ambiente da aggiungere su Vercel

| Variabile | Dove trovarla / cosa inserire |
|---|---|
| `GCP_PROJECT_ID` | ID del progetto Google Cloud (es. `lecter-matrix-prod`) |
| `BQ_DATASET` | `lecter` |
| `BQ_LOCATION` | `europe-west1` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Il contenuto completo del file JSON scaricato al passo precedente |
| `CLOUD_RUN_JOB_NAME` | `lecter-analysis-worker` |
| `CLOUD_RUN_REGION` | `europe-west1` |

Le variabili Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`) vanno **rimosse**.

Le variabili GSC (`GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`, `TOKEN_ENC_KEY`) rimangono invariate.

---

## Quanto costa al mese

Il modello è completamente diverso dal precedente: non c'è più un cron che gira ogni giorno. I costi si accumulano solo quando esegui un'analisi.

**Stima per un'agenzia con 20–50 analisi al mese su proprietà miste:**

| Voce | Stima/mese |
|---|---|
| Storage BigQuery (project, credenziali, gruppi — tutto piccolo) | < $0,01 |
| Query di detection (lettura dati temporanei durante l'analisi) | $0–$5 |
| Cloud Run Job (il worker che gira ore) | $0 (dentro il free tier di GCP) |
| **Totale** | **$0–5/mese** |

BigQuery offre 1 TB di query gratuite al mese. Per 20–50 analisi su proprietà medie, si rimane facilmente dentro quella soglia.

**A confronto:** Supabase Pro parte da $25/mese. BigQuery per questo workload è strutturalmente più economico, con o senza il free tier.

---

## Limiti che devi conoscere: la quota GSC

La Google Search Console API permette al massimo **1 200 chiamate al giorno** per progetto Google Cloud (valore predefinito). Ogni "pagina" di dati scaricata da GSC conta come una chiamata.

Implicazioni pratiche:
- **Proprietà piccole** (meno di 50 000 righe al giorno): un'analisi completa rientra nella quota di un giorno. Tempi: minuti.
- **Proprietà medie** (es. Donna Moderna, ~500 000 righe/giorno): circa 2 giorni di quota. Tempi: 1–2 giorni.
- **Proprietà grandi** (es. Corriere, milioni di righe/giorno): serve un aumento di quota. Richiedendolo su Google Cloud Console, Google concede tipicamente 10 000–50 000 chiamate/giorno per usi legittimi. Con quota aumentata: Corriere in 1–2 giorni.

Il job salva il progresso: se si ferma per quota esaurita, riprende dall'ultimo giorno scaricato alla prossima invocazione.

---

## I vecchi dati su Supabase

I dati attualmente in Supabase sono **dati di test**, non dati di produzione. Non serve nessuna migrazione: si butta via tutto. Il progetto Supabase viene eliminato (o lasciato scadere) e le relative variabili d'ambiente vengono rimosse da Vercel.

---

## Cosa rimane identico

- **Frontend, filtri, paginazione, drill:** nessuna modifica visiva.
- **Logica di cannibalizzazione:** l'algoritmo di detection e scoring non cambia.
- **Connessione GSC:** il flusso OAuth rimane identico (il bottone "Connetti GSC" funziona come prima).
- **GDPR:** i dati BigQuery restano in `europe-west1`. Non escono dall'Europa.
