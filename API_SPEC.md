# API Spec

Next.js App Router route handlers. Every endpoint returns `ApiResult<T>` and goes
through `withHandler` (parse zod → authorize → run repo/service → envelope).
Handlers ≤30 lines; logic lives in `server/repositories` and `server/engine`.

## Envelope & errors
```ts
type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };
interface ApiError { code: ApiErrorCode; message: string; requestId: string; details?: unknown }
interface Paginated<T> { items: T[]; nextCursor: string | null; pageSize: number }
```
| code | HTTP | when |
|---|---|---|
| `validation_error` | 400 | zod parse failed (`details.fieldErrors`) |
| `unauthorized` | 401 | no/invalid session |
| `forbidden` | 403 | authenticated, wrong tenant/role |
| `not_found` | 404 | absent or not in tenant |
| `conflict` | 409 | duplicate (e.g. project property) |
| `rate_limited` | 429 | per-project/user limit (`Retry-After`) |
| `gsc_auth_error` | 422 | GSC connection revoked/expired |
| `internal_error` | 500 | unexpected (logged w/ requestId) |
| `unavailable` | 503 | dependency down |

Throw `ContractError(code, message)` for expected failures; `withHandler` maps it.
Unknown errors → `internal_error`, never leaked. Every response carries `requestId`.

## Endpoints
| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| GET | `/api/me` | session user + account | — |
| GET | `/api/projects` | list projects | — |
| POST | `/api/projects` | create | `CreateProject` |
| GET | `/api/projects/:id` | detail (+conn, +last run) | — |
| PATCH | `/api/projects/:id` | update name/timezone/status/config | `UpdateProject` |
| DELETE | `/api/projects/:id` | delete (cascade) | — |
| GET | `/api/projects/:id/gsc/auth-url` | Google consent URL | — |
| POST | `/api/projects/:id/gsc/connect` | exchange code, store token, backfill | `GscConnect` |
| POST | `/api/projects/:id/gsc/disconnect` | revoke connection | — |
| POST | `/api/projects/:id/sync` | run sync inline | `Sync` |
| POST | `/api/projects/:id/detect` | run detection inline | `Detect` |
| GET | `/api/projects/:id/groups` | list groups (filter/sort/keyset) | `GroupListQuery` |
| GET | `/api/projects/:id/overview` | severity distribution + last run + sync status | — |
| GET | `/api/projects/:id/export` | CSV of filtered groups | `GroupFilter` |
| GET | `/api/groups/:groupId` | drill (group + members) | — |
| PATCH | `/api/groups/:groupId/state` | triage | `UpdateGroupState` |
| POST | `/api/cron/tick` | internal; per-project sync→detect | header `x-cron-secret` |

Node.js runtime for `connect`, `sync`, `detect`, `export`, `cron/tick` (service role / `COPY`).

## Request schemas (zod; in `src/contracts/schemas/requests.ts`)
```ts
CreateProject     = { name:1..200, gscProperty:3..255, propertyType:'domain'|'url_prefix', timezone?:string }
UpdateProject     = { name?, timezone?, status?:'active'|'paused', config?:object } (≥1 field)
GscConnect        = { code:string≥10, redirectUri:url }
Sync              = { mode:'backfill'|'incremental'=incremental, backfillDays?:1..480 }
Detect            = { windowStart?:date, windowEnd?:date }  (start ≤ end)
UpdateGroupState  = { status?:GroupStatus, notes?:string|null } (≥1 field)

GroupFilter = {
  severityBand?: SeverityBand[],   // CSV → compiled to severity ranges
  severityMin?: 0..100,
  cannType?: CannType[],
  intent?: Intent[],
  status?: GroupStatus[],
  pathPrefix?: string,             // member page LIKE prefix%
  inversionOnly?: boolean,
  hideBenign?: boolean,
  q?: string                       // ILIKE on query_norm
}
GroupListQuery = GroupFilter & {
  limit: 1..100 = 50,
  cursor?: string,                 // opaque base64 keyset
  sort?: `${'severity'|'impressions'|'lostClicks'}:${'asc'|'desc'}` = 'severity:desc'
}
```
Querystrings: `z.coerce` numbers/booleans; CSV-enum helper turns `?cannType=a,b` into a validated array (repeated params also accepted). No operators inside values — ranges use `*Min`.

## Response DTOs (`src/contracts/types/entities.ts`)
```ts
interface CannibalizationGroupDTO {
  id: number; groupKey: string; queryNorm: string;
  queryIntent: Intent; searchVolume: number | null;
  cannType: CannType; totalClicks: number; totalImpressions: number; memberCount: number;
  severity: number; severityBand: SeverityBand;           // band derived server-side
  winnerPage: string | null; dominantPage: string | null; inversion: boolean;
  benign: boolean; benignReason: string | null;
  recommendedAction: RecommendedAction; lostClicks: number;
  state: { status: GroupStatus; notes: string | null } | null;
  members?: GroupMemberDTO[];                              // detail only
  updatedAt: string;
}
interface GroupMemberDTO {
  page: string; pageType: PageType; clicks: number; impressions: number;
  position: number; isWinner: boolean;
}
interface ProjectDTO {
  id: string; name: string; gscProperty: string; propertyType: 'domain'|'url_prefix';
  timezone: string; status: 'active'|'paused'|'error'; createdAt: string; updatedAt: string;
  connection?: { status:'connected'|'revoked'|'error'; lastSyncedDate: string|null };
  lastRun?: { id:number; status:'running'|'succeeded'|'failed'; groupsFound:number|null;
              startedAt:string; finishedAt:string|null } | null;
}
interface OverviewDTO {
  bandCounts: Record<SeverityBand, { groups:number; impressions:number; lostClicks:number }>;
  lastRun: ProjectDTO['lastRun'];
  sync: { lastSyncedDate: string|null; status:'connected'|'revoked'|'error' };
}
```
`severityBand` derived: critical ≥70, high 50–69.9, medium 30–49.9, low <30.
DTOs never include secrets (`refresh_token_enc` etc.).

## Pagination / sorting / filtering
- **Keyset only.** Fetch `limit+1`; if an extra row exists, `nextCursor` = base64 of the last `{sortValue,id}`. **No OFFSET.**
- **Sort** is a single whitelisted field; it determines the cursor tuple.
- **Filters** compile to one parameterized `WHERE` via a pure `buildGroupQuery(filter) → {sql, params}`. Never interpolate values.

## Behavior notes
- POST `/projects` → 409 on duplicate `(account, gscProperty)`.
- `/gsc/connect` exchanges the OAuth code, encrypts + stores the refresh token, enqueues nothing — it triggers an inline backfill (or schedules it on the next `cron/tick`).
- `/sync` and `/detect` run inline for the one project, are idempotent, tenant-scoped, and per-project rate-limited.
- PATCH `/state` upserts `group_state` by `group_key` (survives re-runs) and records a business event.
- `/export` streams CSV of the filtered set (same filters as the list).
- `/cron/tick` (cron-secret only, no session): iterate active projects with a connected GSC; per project `syncProject(incremental)` then detect inline; chunk + resume via `last_synced_date` if near timeout.

## Example
`GET /api/projects/abc/groups?severityBand=critical,high&inversionOnly=true&sort=lostClicks:desc&limit=50`
```json
{ "data": { "items": [ {
    "id": 7781, "queryNorm": "carta velina", "cannType": "collection_vs_collection",
    "severity": 72.4, "severityBand": "critical",
    "winnerPage": "/collections/carta-velina-personalizzata",
    "dominantPage": "/collections/carta-velina", "inversion": true,
    "benign": false, "recommendedAction": "consolidate_301", "lostClicks": 34,
    "state": { "status": "open", "notes": null }, "updatedAt": "2026-05-20T..." }
  ], "nextCursor": "eyJ...", "pageSize": 50 }, "error": null }
```
