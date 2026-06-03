# Connessione Google Search Console — Guida per il proprietario

**A chi serve questo doc:** chi approva il progetto e deve capire come funziona la connessione GSC, senza dover leggere il documento tecnico completo.

---

## Cosa fare su Google Cloud Console (una volta sola)

- [ ] Crea un progetto su [console.cloud.google.com](https://console.cloud.google.com)
- [ ] Abilita l'API **Google Search Console API**
- [ ] Vai su *Credenziali* → crea **OAuth 2.0 Client ID** (tipo: Web application)
- [ ] Nella *Consent Screen*, scegli **Interno** se il tuo account Google è un Workspace aziendale — altrimenti Esterno (richiede verifica Google)
- [ ] Aggiungi questi due **Redirect URI** autorizzati:
  - `http://localhost:3000/api/auth/gsc/callback` (sviluppo locale)
  - `https://lecter-matrix.vercel.app/api/auth/gsc/callback` (produzione)
- [ ] Copia **Client ID** e **Client Secret** — ti serviranno dopo

---

## Cosa vedi e fai come utente

Vai su **Settings → [nome progetto] → Connetti Google Search Console**.

1. Clicchi **Connetti GSC** → vieni mandato su Google
2. Scegli l'account Google che gestisce le property che ti interessano
3. Dai il consenso (solo lettura, nessuna modifica)
4. Torni sull'app → vedi il pallino **verde "Connesso"**

Da quel momento il cron gira ogni giorno e scarica automaticamente i dati di tutte le property di quell'account Google. Se in futuro aggiungi una property nuova all'account, diventa accessibile subito, senza dover rifare la connessione.

Per scollegare, c'è il bottone **Disconnetti** nella stessa pagina.

---

## Come funziona sotto, in 5 punti

1. **Connessione salvata** — dopo il consenso, l'app salva in database un "refresh token" legato al progetto (non all'utente che ha cliccato).
2. **Token cifrato** — il refresh token è cifrato prima di entrare nel database; senza la chiave di cifratura non si può leggere.
3. **Cron giornaliero** — ogni notte il cron usa il refresh token per ottenere da Google un access token temporaneo (valido 1 ora).
4. **Scaricamento dati** — con quell'access token chiama le API di Search Console e scarica click, impressioni e posizioni per ogni property.
5. **Salvataggio** — i dati finiscono nella tabella `gsc_metric`; da lì l'analisi di cannibalizzazione può partire.

---

## Variabili d'ambiente da aggiungere su Vercel

| Variabile | Dove trovarla |
|---|---|
| `GSC_CLIENT_ID` | Google Cloud Console → Credenziali → OAuth Client |
| `GSC_CLIENT_SECRET` | Stesso posto |
| `GSC_REDIRECT_URI` | Inserisci: `https://lecter-matrix.vercel.app/api/auth/gsc/callback` |
| `TOKEN_ENC_KEY` | Genera una stringa random di 32 caratteri (es. con `openssl rand -hex 16`) |

Tutte vanno nelle **Environment Variables** di Vercel, mai nel codice.

---

## Cosa può andare storto

- **L'utente revoca il consenso da Google** → il pallino diventa rosso, appare il bottone "Riconnetti"; i dati già scaricati restano intatti.
- **Google scade o invalida il token** → stesso comportamento: pallino rosso, il cron si ferma su quel progetto, gli altri continuano normalmente.
- **Errore di rete durante il cron** → il cron riprova la prossima notte; non perde i dati già scaricati, ricomincia dall'ultimo giorno mancante.
- **Consent screen non verificata** → Google mostra un avviso agli utenti esterni ("app non verificata"); se usi Workspace interno non compare. Per uso interno non è un problema bloccante.
