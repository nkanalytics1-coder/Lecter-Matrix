# OAUTH_DESIGN.md — Specifica eseguibile per Fase B: OAuth Google Search Console

> Documento di design. **Non modifica nessun file esistente.**
> Destinatario: l'agente che implementerà Fase B.
> Riferimenti principali: `CLAUDE.md`, `SSOT.md`, sezioni "Architecture" e "Database rules".

---

## 0. Stato attuale del codebase (snapshot 2026-05-29)

### Cosa già esiste

| Elemento | Posizione | Stato |
|---|---|---|
| Tabella `gsc_connection` | `supabase/migrations/0002_projects.sql` | Esiste — schema parziale (vedi §1) |
| `GscConnectionRow` | `server/db/types.ts` | Esiste — allineato a schema attuale |
| `GscStatus` enum | `src/contracts/types/domain.ts` | Esiste — valori da aggiornare |
| `refreshAccessToken` | `server/ingest/gsc-client.ts` | Completo — accetta token in chiaro |
| `querySearchAnalytics` | `server/ingest/gsc-client.ts` | Completo — T15 |
| `persistDate` | `server/ingest/persist.ts` | Completo — T16 |
| Route `gsc/auth-url` | `app/api/projects/[id]/gsc/auth-url/route.ts` | Stub 501 |
| Route `gsc/connect` | `app/api/projects/[id]/gsc/connect/route.ts` | Stub 501 |
| Route `gsc/disconnect` | `app/api/projects/[id]/gsc/disconnect/route.ts` | Stub 501 |
| `syncProject` | `server/cron/tick.ts` | Stub — ritorna subito senza fare nulla |
| `LEFT JOIN gsc_connection` | `server/repositories/project.repo.ts`, `misc.repo.ts` | Funzionante — legge `status`, `last_synced_date` |

### Schema attuale di `gsc_connection` (0002\_projects.sql)

```sql
create table gsc_connection (
  project_id        uuid    primary key references project(id) on delete cascade,
  google_sub        text    not null,
  refresh_token_enc bytea   not null,
  scopes            text[]  not null,
  last_synced_date  date,
  status            text    not null default 'connected',
  updated_at        timestamptz not null default now(),
  constraint ck_gsc_status
    check (status in ('connected','revoked','error'))
);
```

**Delta rispetto al target** (vedi §1):

| Colonna | Azione |
|---|---|
| `google_sub` | Mantenere (identificatore stabile Google) |
| `google_account_email` | **Aggiungere** |
| `refresh_token_enc bytea` | **Cambiare tipo a `text`** (base64) |
| `scopes` | **Rimuovere** — scope è fisso (`webmasters.readonly`) |
| `access_token` | **Aggiungere** |
| `access_token_expires_at` | **Aggiungere** |
| `connected_at` | **Aggiungere** |
| `revoked_at` | **Aggiungere** |
| `status` check constraint | **Aggiornare** — valori target: `pending/connected/disconnected/revoked` |

La migrazione forward è `0005_gsc_connection_v2.sql` (vedi §8 per la lista completa).
Non modificare `0002_projects.sql`.

---

## 1. Schema target di `gsc_connection`

### DDL target (da implementare in `0005_gsc_connection_v2.sql`)

```sql
-- Rimuove il vecchio check constraint e le colonne obsolete,
-- aggiunge le nuove colonne, riallinea il check constraint.

ALTER TABLE gsc_connection
  ADD COLUMN google_account_email     text,
  ADD COLUMN access_token             text,
  ADD COLUMN access_token_expires_at  timestamptz,
  ADD COLUMN connected_at             timestamptz,
  ADD COLUMN revoked_at               timestamptz;

ALTER TABLE gsc_connection
  ALTER COLUMN refresh_token_enc TYPE text USING encode(refresh_token_enc, 'base64');

ALTER TABLE gsc_connection
  DROP COLUMN scopes;

ALTER TABLE gsc_connection
  DROP CONSTRAINT ck_gsc_status;

ALTER TABLE gsc_connection
  ADD CONSTRAINT ck_gsc_status
    CHECK (status IN ('pending','connected','disconnected','revoked'));

-- Riallinea i valori esistenti: 'error' → 'revoked'
UPDATE gsc_connection SET status = 'revoked' WHERE status = 'error';

-- Backfill connected_at per le righe esistenti
UPDATE gsc_connection SET connected_at = updated_at WHERE connected_at IS NULL;

-- Ora rende le nuove colonne NOT NULL dove applicabile
ALTER TABLE gsc_connection
  ALTER COLUMN google_account_email SET NOT NULL,
  ALTER COLUMN connected_at SET NOT NULL;
```

### Schema completo post-migrazione

| Colonna | Tipo SQL | Nullable | Default | Note |
|---|---|---|---|---|
| `project_id` | `uuid` | NO | — | PK; FK → `project(id) ON DELETE CASCADE` |
| `google_sub` | `text` | NO | — | Subject claim dal token ID Google (`sub`). Stabile anche se l'email cambia. |
| `google_account_email` | `text` | NO | — | Email dell'account Google (`email` claim). Solo display. |
| `refresh_token_enc` | `text` | NO | — | AES-256-GCM, base64. Vedere §2. |
| `access_token` | `text` | YES | NULL | Token di accesso in chiaro, durata ~1 h. NULL finché non è stato fatto il primo refresh. |
| `access_token_expires_at` | `timestamptz` | YES | NULL | Scadenza dell'`access_token`. NULL se non ancora popolato. |
| `status` | `text` | NO | `'pending'` | Enum: `pending/connected/disconnected/revoked`. |
| `last_synced_date` | `date` | YES | NULL | Ultima data GSC sincronizzata con successo. NULL = mai sincronizzato. |
| `connected_at` | `timestamptz` | NO | `now()` | Timestamp del completamento OAuth (prima connessione o riconnessione). |
| `revoked_at` | `timestamptz` | YES | NULL | Timestamp della revoca (lato Google o lato utente). |
| `updated_at` | `timestamptz` | NO | `now()` | Aggiornato ad ogni write. |

### Indici

La tabella ha un solo accesso pattern: `WHERE project_id = $1`.
La PK su `project_id` copre questo pattern. **Nessun indice aggiuntivo necessario.**

### Constraint

```sql
constraint ck_gsc_status check (status in ('pending','connected','disconnected','revoked'))
```

**Nessuna colonna UNIQUE aggiuntiva**: la PK `project_id` garantisce già un'unica connessione per progetto.

### Giustificazione delle scelte

- **`google_sub` mantenuto**: è l'identificatore stabile di Google. Se l'utente cambia email, `sub` resta invariato. Utile per rilevare riconnessioni con account diverso.
- **`google_account_email` aggiunto**: solo display nell'UI settings; mai usato come chiave di ricerca.
- **`refresh_token_enc text` (base64 invece di `bytea`)**: il formato `text` base64 è più portabile in `pg_dump`, più leggibile nei log di debug (anche se cifrato), e semplifica il round-trip con `crypto` di Node che lavora in base64. Il costo in spazio è ~33% in più rispetto a `bytea` — trascurabile per una riga per progetto.
- **`access_token` in chiaro**: la durata è ~1 ora. Memorizzarlo nel DB serve da cache cross-instance per Vercel serverless (dove la `tokenCache` in-memory di `gsc-client.ts` non sopravvive tra invocazioni). Il rischio di esposizione è basso per la breve durata.
- **`access_token_expires_at`**: permette di decidere senza chiamare Google se l'`access_token` in cache è ancora valido.
- **`scopes` rimosso**: lo scope è fisso a `webmasters.readonly`. Salvarlo era ridondante. Se in futuro cambierà, la migrazione aggiungerà la colonna.
- **`connected_at` / `revoked_at`**: audit immutabili. `connected_at` non si aggiorna su refresh, solo su riconnessione OAuth. `revoked_at` è impostato una sola volta.
- **Status `pending`**: necessario per la finestra di tempo tra la generazione dell'auth URL e il completamento del callback Google. Permette di distinguere "in attesa di autenticazione" da "mai connesso" (assenza di riga).
- **Status `disconnected`**: disconnessione volontaria lato utente. I token vengono azzerati (`access_token = NULL`, `refresh_token_enc` svuotato). Distinto da `revoked` (revoca lato Google).

---

## 2. Cifratura del refresh token: AES-256-GCM

### Scelta algoritmo: AES-256-GCM

AES-256-GCM è autenticato (AEAD): garantisce **confidenzialità** (AES-CTR) **e integrità** (GHASH tag da 128 bit). Un attaccante che modifica il ciphertext nel DB ottiene un errore di decifrazione, non dati corrotti silenziosamente. È la scelta standard per la cifratura di segreti a riposo in ambito web (AWS Secrets Manager, HashiCorp Vault usano internamente GCM). Alternativa scartata: AES-256-CBC richiede padding e non è autenticato — vulnerabile a padding oracle.

### Formato wire (stringa base64 stored in DB)

```
base64( IV[12 byte] ‖ ciphertext[N byte] ‖ authTag[16 byte] )
```

- **IV (nonce)**: 12 byte casuali generati con `crypto.randomBytes(12)`. Uno per ogni cifratura. **Mai riusare lo stesso IV con la stessa chiave.**
- **Ciphertext**: output AES-256-GCM, lunghezza = lunghezza del plaintext (refresh token Google tipicamente 100-200 char UTF-8).
- **Auth tag**: 16 byte (128 bit) prodotti automaticamente da Node `createCipheriv('aes-256-gcm', ...)`. Verificati automaticamente in decifrazione.
- **Encoding finale**: `Buffer.concat([iv, ciphertext, tag]).toString('base64')` → stringa `text` nel DB.

### Chiave di cifratura: `TOKEN_ENC_KEY`

- **Formato**: 32 byte casuali codificati in base64 standard (44 caratteri). Generazione: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **Dove vive**: env var `TOKEN_ENC_KEY`. **Solo lato server** (`import 'server-only'` in `token-crypto.ts`). Mai in bundle client, mai in log.
- **In sviluppo**: `.env.local` (già gitignored).
- **In produzione**: Vercel → Settings → Environment Variables → scope `Production + Preview`.
- **Caricamento in runtime**: `Buffer.from(process.env['TOKEN_ENC_KEY'] ?? '', 'base64')` — validare che la lunghezza sia 32 byte all'avvio del modulo (throw altrimenti).

### Funzioni da implementare in `server/ingest/token-crypto.ts`

```
encrypt(plaintext: string, key: Buffer): string
  // → base64(IV ‖ ciphertext ‖ tag)

decrypt(encoded: string, key: Buffer): string
  // → plaintext; throw se tag non valido
```

Entrambe pure, sincrone (Node `crypto` è sync per operazioni in-process). Nessuna chiamata di rete.

### Rotazione della chiave (out-of-scope per v1 — documentata per il futuro)

In v1 esiste una sola chiave. Quando sarà necessario ruotarla:

1. Aggiungere `TOKEN_ENC_KEY_OLD` come env var con il valore precedente.
2. Eseguire un job di migrazione (script one-shot, non in path di produzione) che:
   a. Legge ogni `refresh_token_enc` da DB.
   b. Decifra con `TOKEN_ENC_KEY_OLD`.
   c. Cifra con la nuova `TOKEN_ENC_KEY`.
   d. Aggiorna la riga.
3. Rimuovere `TOKEN_ENC_KEY_OLD` dopo che tutte le righe sono migrate.

Non è necessario aggiungere un campo `key_version` alla tabella: il job processa tutte le righe in modo idempotente. Se si usasse un KMS esterno (es. AWS KMS), la chiave DEK (data encryption key) sarebbe wrappata dalla KMS master key — pattern noto come envelope encryption — ma è fuori scope per v1.

---

## 3. Flusso OAuth Google

### Scope richiesto

```
https://www.googleapis.com/auth/webmasters.readonly
```

È lo scope minimo per chiamare `searchAnalytics.query`. Nessuno scope aggiuntivo deve essere richiesto (principio del minimo privilegio). Lo scope è hardcoded nel server — non configurabile dall'utente.

### Redirect URI

| Ambiente | URI |
|---|---|
| Sviluppo locale | `http://localhost:3000/api/auth/gsc/callback` |
| Produzione (Vercel) | `https://<dominio-prod>/api/auth/gsc/callback` |

Entrambi devono essere registrati in Google Cloud Console → API & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs.

L'URI esatto viene letto dall'env var `GSC_REDIRECT_URI` (vedi §5) — non hardcoded nel codice — così da non richiedere modifiche al codice al cambio di dominio.

### Parametri Authorization URL

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id={GSC_CLIENT_ID}
  &redirect_uri={GSC_REDIRECT_URI}
  &response_type=code
  &scope=https://www.googleapis.com/auth/webmasters.readonly
  &access_type=offline
  &prompt=consent
  &state={STATE_TOKEN}
```

- **`access_type=offline`**: necessario per ricevere il `refresh_token`. Senza questo parametro Google restituisce solo `access_token`.
- **`prompt=consent`**: forza la schermata di consenso ad ogni autorizzazione. **Fondamentale**: senza `prompt=consent`, Google restituisce `refresh_token` solo alla prima autorizzazione di un utente — le autorizzazioni successive restituiscono solo `access_token`. Poiché l'app deve sempre ottenere un nuovo `refresh_token` (per sovrascrivere quello precedente in caso di riconnessione), `prompt=consent` è obbligatorio.
- **`state`**: token opaco per prevenire CSRF (vedi §3.1).

### 3.1 Protezione CSRF con `state`

**Generazione (in `auth-url` handler)**:

1. Generare `nonce = crypto.randomUUID()`.
2. Costruire il payload: `{ projectId, nonce }`.
3. Serializzare: `state = Buffer.from(JSON.stringify(payload)).toString('base64url')`.
4. Firmare: `sig = crypto.createHmac('sha256', TOKEN_ENC_KEY).update(state).digest('hex')`.
5. Valore finale del parametro `state`: `${state}.${sig}`.
6. Salvare `nonce` in un cookie httpOnly, `SameSite=Lax`, `Max-Age=600` (10 minuti), `Path=/api/auth/gsc/callback`, nome `gsc_oauth_nonce`.

**Validazione (in callback handler)**:

1. Estrarre `state` e `sig` dal parametro.
2. Ricalcolare `expectedSig = HMAC-SHA256(state)`.
3. Confrontare con `crypto.timingSafeEqual` — se diversi: redirect con `?error=gsc_state_mismatch`.
4. Decodificare `payload = JSON.parse(Buffer.from(state, 'base64url'))`.
5. Leggere `nonce` dal cookie `gsc_oauth_nonce`.
6. Confrontare `payload.nonce === cookieNonce` — se diversi: redirect con `?error=gsc_state_mismatch`.
7. Cancellare il cookie `gsc_oauth_nonce` (`Max-Age=0`).
8. Il `payload.projectId` è ora verificato e sicuro.

### 3.2 Scambio codice → token (token exchange)

Endpoint: `POST https://oauth2.googleapis.com/token`

Body (`application/x-www-form-urlencoded`):
```
code={CODE}
client_id={GSC_CLIENT_ID}
client_secret={GSC_CLIENT_SECRET}
redirect_uri={GSC_REDIRECT_URI}
grant_type=authorization_code
```

Risposta attesa:
```json
{
  "access_token": "...",
  "expires_in": 3599,
  "refresh_token": "...",
  "scope": "https://www.googleapis.com/auth/webmasters.readonly",
  "token_type": "Bearer",
  "id_token": "..."
}
```

**Verifica scope**: controllare che `response.scope` contenga `webmasters.readonly`. Se mancante: il refresh futuro potrebbe fallire silenziosamente — trattare come errore di autorizzazione.

**`id_token`**: decodificare il payload JWT (senza verifica della firma — non necessaria qui, il token arriva via HTTPS da Google). Estrarre `sub` e `email`.

### 3.3 Gestione errori OAuth

| Caso | Come si manifesta | Azione |
|---|---|---|
| Utente nega il consenso | Google redirige con `?error=access_denied` | Redirect a settings con `?gsc=error&reason=denied` |
| `state` manomesso o scaduto | Validazione CSRF fallisce (vedi §3.1) | Redirect con `?gsc=error&reason=state_mismatch` |
| Codice scaduto (> 10 min) | Token exchange risponde `error: invalid_grant` | Redirect con `?gsc=error&reason=code_expired` |
| `invalid_grant` generico | Token exchange: `error: invalid_grant` | Redirect con `?gsc=error&reason=auth_failed` |
| Errore 5xx di Google | Token exchange: HTTP 5xx | Log + redirect con `?gsc=error&reason=google_unavailable` |
| Scope insufficiente | `response.scope` non contiene `webmasters.readonly` | Redirect con `?gsc=error&reason=insufficient_scope` |
| Progetto non trovato | `payload.projectId` non esiste nel DB | Redirect con `?gsc=error&reason=project_not_found` |

In tutti i casi di errore **non fare throw lato server**: il callback deve sempre completare con un redirect (non una risposta JSON) perché il browser dell'utente si trova sulla pagina di Google.

---

## 4. Variabili d'ambiente

### Variabili nuove da aggiungere per Fase B

| Nome | Tipo | Dove si configura | Descrizione |
|---|---|---|---|
| `GSC_CLIENT_ID` | `string` | Google Cloud Console → Credentials → OAuth 2.0 → Client ID | Client ID dell'applicazione OAuth. Anche noto come "client_id". |
| `GSC_CLIENT_SECRET` | `string` | Google Cloud Console → Credentials → OAuth 2.0 → Client secret | Segreto del client OAuth. **Non esporre al client.** |
| `GSC_REDIRECT_URI` | `string` | `.env.local` e Vercel | URI completo del callback. Dev: `http://localhost:3000/api/auth/gsc/callback`. Prod: l'URL Vercel. |
| `TOKEN_ENC_KEY` | `string` (base64, 32 byte) | `.env.local` e Vercel | Chiave AES-256-GCM per cifrare il refresh token. Generare con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |

### Variabili esistenti già usate (nessuna modifica necessaria)

| Nome | Usata in |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `server/auth.ts` — client anon SSR |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `server/auth.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/db/client.ts` |
| `CRON_SECRET` | `app/api/cron/tick/route.ts` |

`GSC_CLIENT_ID` e `GSC_CLIENT_SECRET` sono già referenziati in `server/ingest/gsc-client.ts` (funzione `refreshAccessToken`). Aggiungere solo `GSC_REDIRECT_URI` e `TOKEN_ENC_KEY`.

### Procedura di configurazione

1. **Google Cloud Console**:
   - Navigare in API & Services → Credentials → Create OAuth 2.0 Client ID.
   - Application type: Web application.
   - Authorized redirect URIs: aggiungere entrambi i valori (dev e prod).
   - Copiare Client ID e Client secret.

2. **Vercel**:
   - Project Settings → Environment Variables.
   - Aggiungere `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`, `TOKEN_ENC_KEY`.
   - Scope: Production (e Preview se necessario per staging).
   - Nessuna variabile deve essere marcata come "Exposed to browser".

3. **Locale**:
   - Aggiungere a `.env.local` (già nel `.gitignore`).
   - `GSC_REDIRECT_URI=http://localhost:3000/api/auth/gsc/callback`.

---

## 5. Route da implementare in Fase B

Le route usano tutte `withHandler` di `server/http.ts` e `requireSession` per la protezione.
Le route `auth-url`, `connect`, `disconnect` esistono come stub 501 — devono essere riscritte (non create).
La route callback è **nuova**.

---

### 5.1 `GET /api/projects/[id]/gsc/auth-url`

**File**: `app/api/projects/[id]/gsc/auth-url/route.ts`

**Chi la chiama**: frontend (pagina onboarding o settings), quando l'utente clicca "Connetti Google Search Console".

**Signature handler**:
```
export const GET = withHandler({ protected: true }, async ({ user, requestId }) => { ... })
```
Il `projectId` si ottiene dai path params: `const { id: projectId } = await ctx.params`.

**Comportamento**:
1. Verificare che il progetto esista (chiamare `getProject(projectId)`) — se non esiste: `throw new ContractError('not_found', ...)`.
2. Verificare che l'utente sia autenticato (già garantito da `protected: true`).
3. Generare `nonce = crypto.randomUUID()`.
4. Costruire e firmare lo `state` (vedi §3.1).
5. Impostare il cookie `gsc_oauth_nonce` via `cookies().set(...)` — httpOnly, SameSite=Lax, Max-Age=600, Path=/api/auth/gsc/callback.
6. Costruire l'authorization URL con i parametri di §3.
7. Aggiornare `gsc_connection.status = 'pending'` per il `projectId` (upsert — crea la riga se non esiste ancora). Questo segnala all'UI che un OAuth è in corso.
8. Ritornare `ApiResult<{ url: string }>` con l'URL costruito.

**Risposta successo**: `200 { data: { url: "https://accounts.google.com/o/oauth2/v2/auth?..." }, error: null }`.

**Risposte errore**: `404 not_found` se il progetto non esiste; `401 unauthorized` se non autenticato.

---

### 5.2 `GET /api/auth/gsc/callback` *(NUOVA)*

**File**: `app/api/auth/gsc/callback/route.ts` *(da creare)*

**Chi la chiama**: Google, in modo automatico come redirect del browser dell'utente dopo il consenso.

**Signature**: funzione `GET(req: Request): Promise<Response>` — **non** usa `withHandler` (non è una API JSON, risponde sempre con redirect). Non è protetta da session.

**Parametri URL attesi**:
- Caso successo: `?code=...&state=...`
- Caso rifiuto: `?error=access_denied&state=...`

**Comportamento — caso rifiuto (parametro `error` presente)**:
1. Redirect a `/app/projects/{projectId}/settings?gsc=error&reason=denied`.
2. Il `projectId` si estrae dallo `state` dopo aver validato la firma (o, se la firma non è verificabile, redirect a `/app` con errore generico).

**Comportamento — caso successo**:
1. Estrarre `code` e `state` dai searchParams.
2. Validare lo `state` (firma + nonce cookie) come descritto in §3.1. In caso di fallimento: redirect con `reason=state_mismatch`.
3. Estrarre `projectId` dallo `state` verificato.
4. Chiamare il token endpoint Google (vedi §3.2). In caso di errore: redirect con `reason=auth_failed` (o la reason specifica dalla tabella §3.3).
5. Verificare scope nella risposta.
6. Estrarre `sub` e `email` dal `id_token` (JWT decode del payload, senza verifica firma).
7. Cifrare `refresh_token` con `encrypt(refreshToken, TOKEN_ENC_KEY)` → `refresh_token_enc`.
8. Calcolare `access_token_expires_at = new Date(Date.now() + expires_in * 1000)`.
9. Upsert `gsc_connection`:
   ```
   INSERT INTO gsc_connection (
     project_id, google_sub, google_account_email,
     refresh_token_enc, access_token, access_token_expires_at,
     status, connected_at, updated_at
   ) VALUES (...)
   ON CONFLICT (project_id) DO UPDATE SET
     google_sub = EXCLUDED.google_sub,
     google_account_email = EXCLUDED.google_account_email,
     refresh_token_enc = EXCLUDED.refresh_token_enc,
     access_token = EXCLUDED.access_token,
     access_token_expires_at = EXCLUDED.access_token_expires_at,
     status = 'connected',
     connected_at = now(),
     revoked_at = NULL,
     updated_at = now()
   ```
10. Cancellare il cookie `gsc_oauth_nonce` (`Max-Age=0`).
11. Redirect a `/app/projects/{projectId}/settings?gsc=connected`.

**Non ritornare mai JSON**: questa route è chiamata dal browser dell'utente come redirect di Google. Il browser si aspetta un redirect (3xx), non una risposta JSON.

---

### 5.3 `POST /api/projects/[id]/gsc/connect`

**File**: `app/api/projects/[id]/gsc/connect/route.ts`

**Chi la chiama**: frontend (settings), nel caso di **riconnessione** dopo una disconnessione o revoca. Tecnicamente equivale a richiamare `auth-url` e seguire il flusso OAuth da capo — ma fornisce un'azione esplicita "Riconnetti" distinta dall'onboarding iniziale.

**Signature handler**:
```
export const POST = withHandler({ protected: true }, async ({ requestId }) => { ... })
```

**Comportamento**:
1. Verificare che il progetto esista.
2. Verificare che lo status corrente sia `disconnected` o `revoked` (non `connected` — usare `not_implemented` o `conflict` se già connesso e attivo). Se già `connected`: `throw new ContractError('conflict', 'Project is already connected')`.
3. Generare il nuovo `state` e il cookie come in §5.1 (identico).
4. Aggiornare `status = 'pending'`.
5. Ritornare `ApiResult<{ url: string }>` con la nuova authorization URL.

**Nota**: il flusso di autenticazione che segue dopo la chiamata a `connect` è identico a quello di `auth-url` — entrambi terminano al callback §5.2. La separazione tra `auth-url` (prima connessione) e `connect` (riconnessione) è puramente semantica per il frontend, non strutturale.

---

### 5.4 `POST /api/projects/[id]/gsc/disconnect`

**File**: `app/api/projects/[id]/gsc/disconnect/route.ts`

**Chi la chiama**: frontend (settings), quando l'utente clicca "Disconnetti".

**Signature handler**:
```
export const POST = withHandler({ protected: true }, async ({ requestId }) => { ... })
```

**Comportamento**:
1. Verificare che il progetto esista.
2. Verificare che `gsc_connection` esista per il `projectId` — se non esiste: `throw new ContractError('not_found', 'No GSC connection for this project')`.
3. Aggiornare la riga:
   ```sql
   UPDATE gsc_connection
   SET status = 'disconnected',
       access_token = NULL,
       access_token_expires_at = NULL,
       refresh_token_enc = '',
       revoked_at = now(),
       updated_at = now()
   WHERE project_id = $1
   ```
   Il `refresh_token_enc` viene svuotato (stringa vuota) invece di NULL per mantenere il NOT NULL constraint. Alternativa: impostare `status = 'disconnected'` e lasciare il token cifrato — la scelta di svuotarlo è più conservativa (riduce il rischio in caso di dump DB).
4. **Opzionale v1**: tentare la revoca del token lato Google via `POST https://oauth2.googleapis.com/revoke?token={access_token}`. Se fallisce, ignorare l'errore (il token scadrà comunque). Non bloccare il flusso su questo step.
5. Ritornare `ApiResult<{ disconnected: true }>`.

---

## 6. Edge case

### 6.1 Revoca lato Google (`invalid_grant`)

**Quando accade**: Google può revocare il refresh token se l'utente revoca l'accesso dalla sua pagina account Google, se il token non viene usato per > 6 mesi, o se l'app supera il numero massimo di token attivi per utente.

**Come si manifesta**: `refreshAccessToken()` in `gsc-client.ts` riceve HTTP 401 o 403 — lancia `ContractError('gsc_auth_error', ...)`.

**Dove viene catturato**: in `syncProject` (vedi §7). Il catch deve:
1. Se l'errore è `gsc_auth_error`: aggiornare `gsc_connection.status = 'revoked'`, impostare `revoked_at = now()`, azzerare `access_token`.
2. Loggare `log.warn(requestId, 'gsc.token_revoked', { projectId })`.
3. Non propagare l'errore — il cron tick deve continuare con gli altri progetti.
4. Il project.status rimane `active`: l'utente può riconnettersi.

Il frontend rileva la revoca leggendo `connection.status === 'revoked'` dalla `ProjectDTO` e mostra un banner "Connessione GSC revocata — riconnetti".

### 6.2 Token scaduto durante una sync

**Scenario**: `access_token_expires_at` è nel passato quando `syncProject` parte.

**Gestione**:
1. All'inizio di `syncProject`, confrontare `access_token_expires_at` con `Date.now() + 60_000` (margine di 1 minuto).
2. Se scaduto o nullo: chiamare `refreshAccessToken(plainRefreshToken)` da `gsc-client.ts`.
3. Aggiornare `access_token` e `access_token_expires_at` nel DB prima di procedere con le chiamate GSC.
4. Se il refresh lancia `gsc_auth_error`: gestire come §6.1 (revoca).

In questo modo la `tokenCache` in-memory di `gsc-client.ts` e il DB agiscono come cache a due livelli: la cache in-memory è più veloce (nessuna query DB), ma è per-istanza; il DB è la fonte di verità cross-istanza.

### 6.3 Race condition: cron e sync manuale simultanei

**Scenario**: il cron Vercel e un trigger manuale (o una riesecuzione del cron) partono contemporaneamente per lo stesso `projectId`.

**Causa del problema**: entrambi leggono `last_synced_date`, calcolano le stesse date da sincronizzare, e fanno chiamate doppie a Google.

**Soluzione**: **advisory lock Postgres per progetto**.

All'inizio di `syncProject`:
```sql
SELECT pg_try_advisory_lock(hashtext($1))
```
- Se ritorna `false`: un'altra istanza sta già processando questo progetto → ritornare `{ datesSynced: 0, skipped: 'lock_held' }`.
- Se ritorna `true`: procedere. Al termine (successo o errore): `SELECT pg_advisory_unlock(hashtext($1))`.

L'`hashtext` di un UUID produce un bigint deterministico. Il lock è session-scoped in Postgres: viene rilasciato automaticamente se la connessione cade. Con il driver `postgres` v3 (in uso nel progetto), la connessione è per-request in modalità transazionale — usare `sql.unsafe('SELECT pg_try_advisory_lock($1)', [hashtext])` fuori da un `sql.begin`.

Le scritture di `persistDate` sono già idempotenti (`ON CONFLICT DO UPDATE`) — il lock serve solo a evitare chiamate GSC duplicate e aggiornamenti concorrenti di `last_synced_date`.

### 6.4 Disconnessione utente Supabase

**Scenario**: l'utente Supabase (l'operatore) si disconnette dall'app mentre un cron è in esecuzione.

**Impatto**: nessuno. Il cron usa `serviceClient()` (service role), non la sessione utente. Le route OAuth (`auth-url`, `connect`, `disconnect`) richiedono `requireSession()` — se l'utente non è autenticato, ritornano `401`. Il cron continua indipendentemente.

### 6.5 Riconnessione su progetto già connesso

**Scenario**: il progetto ha già `status = 'connected'`. L'utente vuole cambiare l'account Google collegato.

**Flusso corretto**: l'utente deve prima disconnettersi (§5.4) poi riconnettersi (§5.3). Il frontend deve mostrare le due azioni in sequenza.

**Comportamento del callback** (§5.2) in caso di upsert su riga già `connected`: l'`ON CONFLICT DO UPDATE` sovrascrive i token e imposta `connected_at = now()`. Questo è il comportamento corretto se il flusso è già stato validato (state + nonce verificati). L'upsert garantisce l'atomicità — non è possibile un "mezzo aggiornamento".

Se l'utente bypassa l'UI e chiama direttamente `auth-url` senza passare per `disconnect`, il comportamento è identico: la riconnessione sovrascrive i vecchi token. È accettabile — lo `state` firmato garantisce che la richiesta sia autentica.

### 6.6 `refresh_token` assente nella risposta Google

**Quando accade**: se il flusso è stato chiamato senza `prompt=consent` su un account già autorizzato, Google non restituisce `refresh_token`.

**Gestione nel callback** (§5.2): se `response.refresh_token` è `undefined` o assente:
- Redirect con `?gsc=error&reason=no_refresh_token`.
- **Non** sovrascrivere il `refresh_token_enc` esistente nel DB (non fare upsert in questo caso).
- Il log deve indicare `gsc.missing_refresh_token` — segnala che `prompt=consent` è mancante nell'URL.

Prevenzione: assicurarsi che `prompt=consent` sia sempre presente nell'authorization URL generato in §5.1 e §5.3.

---

## 7. Modifiche a `syncProject` (cron tick)

### Comportamento target di `syncProject(projectId: string)`

La funzione si trova in `server/cron/tick.ts`. Attualmente è uno stub che ritorna `{ datesSynced: 0, skipped: 'gsc not connected' }`.

**Logica completa**:

```
1. Acquisire advisory lock → se fallisce, return { datesSynced: 0, skipped: 'lock_held' }

2. Leggere la connection: SELECT * FROM gsc_connection WHERE project_id = $1
   → se non esiste o status != 'connected': return { datesSynced: 0, skipped: 'not_connected' }

3. Determinare l'access token valido:
   a. Se access_token IS NOT NULL AND access_token_expires_at > now() + 60s
      → usare access_token dal DB
   b. Altrimenti:
      - decrypt(refresh_token_enc) → plainRefreshToken
      - accessToken = await refreshAccessToken(plainRefreshToken)
        (gsc-client gestisce già il token cache in-memory)
      - Salvare nuovo access_token e expires_at nel DB
   c. Se refreshAccessToken lancia gsc_auth_error:
      - UPDATE status='revoked', revoked_at=now(), access_token=NULL
      - log.warn + return { datesSynced: 0, skipped: 'revoked' }

4. Determinare il range di date:
   - endDate = utcYesterday()
   - startDate = last_synced_date IS NULL
                 ? addDays(endDate, -(INITIAL_SYNC_DAYS - 1))   // 90 giorni default
                 : addDays(last_synced_date, 1)
   - Se startDate > endDate: return { datesSynced: 0, skipped: 'up_to_date' }

5. Per ciascuna data d in [startDate..endDate]:
   a. rows = await querySearchAnalytics({
        accessToken, siteUrl: project.gsc_property,
        startDate: d, endDate: d,
        dimensions: ['query','page']
      })
   b. rawRows = rows.map(r => ({
        query: r.keys[0], page: r.keys[1],
        clicks: r.clicks, impressions: r.impressions, position: r.position
      }))
   c. await persistDate(projectId, d, rawRows)
   d. UPDATE gsc_connection SET last_synced_date = d, updated_at = now()
      WHERE project_id = $1
   e. datesSynced++

6. Rilasciare advisory lock

7. return { datesSynced, skipped: null }
```

**Nota**: `querySearchAnalytics` ha la paginazione già implementata in `gsc-client.ts`. `persistDate` è già implementata con batching e `ON CONFLICT DO UPDATE`. Non reimplementarli.

**Costante da aggiungere** in `tick.ts`:
```
const INITIAL_SYNC_DAYS = 90
```

### File che Fase B dovrà toccare

**File esistenti da modificare** (non creare):

| File | Modifica |
|---|---|
| `supabase/migrations/` | Creare `0005_gsc_connection_v2.sql` con il DDL di §1 |
| `src/contracts/types/domain.ts` | Aggiornare `GscStatus` da `['connected','revoked','error']` a `['pending','connected','disconnected','revoked']` |
| `server/db/types.ts` | Aggiornare `GscConnectionRow` per riflettere le nuove colonne (aggiungere `google_account_email`, `access_token`, `access_token_expires_at`, `connected_at`, `revoked_at`; cambiare `refresh_token_enc: Buffer` in `refresh_token_enc: string`; rimuovere `scopes`) |
| `server/repositories/misc.repo.ts` | Aggiornare il fallback `status: 'error' as GscStatus` alla riga di `getOverview` — `'error'` non è più un valore valido del nuovo enum; usare `'disconnected'` o gestire l'assenza di riga diversamente |
| `server/cron/tick.ts` | Implementare `syncProject` come descritto sopra; rimuovere il commento `TODO(wave-oauth)` |
| `app/api/projects/[id]/gsc/auth-url/route.ts` | Implementare (stub 501 → handler reale §5.1) |
| `app/api/projects/[id]/gsc/connect/route.ts` | Implementare (stub 501 → handler reale §5.3) |
| `app/api/projects/[id]/gsc/disconnect/route.ts` | Implementare (stub 501 → handler reale §5.4) |

**File nuovi da creare**:

| File | Contenuto |
|---|---|
| `server/ingest/token-crypto.ts` | `encrypt(plaintext, key)` e `decrypt(encoded, key)` con AES-256-GCM |
| `server/repositories/connection.repo.ts` | `getConnection(projectId)`, `upsertConnection(data)`, `updateConnectionStatus(projectId, status, extra?)`, `updateLastSyncedDate(projectId, date)`, `updateAccessToken(projectId, token, expiresAt)` |
| `app/api/auth/gsc/callback/route.ts` | Handler GET del callback Google (§5.2) |

**File che NON devono essere toccati**:

- `server/ingest/gsc-client.ts` — `refreshAccessToken` e `querySearchAnalytics` non cambiano.
- `server/ingest/persist.ts` — `persistDate` non cambia.
- `server/ingest/normalize.ts` — non cambia.
- `server/repositories/project.repo.ts` — il `LEFT JOIN gsc_connection` già seleziona `conn_status` e `last_synced_date`; le nuove colonne non sono necessarie nella `ProjectDTO`.
- `server/engine/` — il motore di detection non è coinvolto.
- `supabase/migrations/0001-0004` — mai modificare migrazioni già mergate.

---

## 8. Checklist pre-implementazione per l'agente Fase B

Prima di iniziare:

- [ ] Variabili `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`, `TOKEN_ENC_KEY` presenti in `.env.local`.
- [ ] Google Cloud Console: progetto OAuth creato, redirect URI dev registrato.
- [ ] `tsc --noEmit` passa verde sul codebase attuale.

Ordine di implementazione consigliato (ogni step deve lasciare `tsc` verde):

1. `0005_gsc_connection_v2.sql` + aggiornamento di `GscConnectionRow` e `GscStatus`.
2. `token-crypto.ts` + test unitari di encrypt/decrypt.
3. `connection.repo.ts` + test di integrazione su DB effimero.
4. Callback route (`/api/auth/gsc/callback`) + `auth-url` handler.
5. `connect` e `disconnect` handler.
6. `syncProject` in `tick.ts`.
7. Aggiornamento `misc.repo.ts` per il fallback `GscStatus`.
8. Run `tsc --noEmit` e test suite completa.
