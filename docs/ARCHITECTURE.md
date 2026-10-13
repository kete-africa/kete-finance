# Architecture

A modular monolith (doctrine ARCHITECTURE_APP §1): one deployment, cut into features. Every surface
— screens, MCP, API, worker — calls the same use cases.

```mermaid
flowchart TB
  subgraph Surfaces
    S[screens · src/routes]
    M[/mcp · capabilities + views/]
    API[/api/avis · /health · /.well-known/]
    WK[worker · jobs]
  end
  subgraph Feature["src/features/<feature>"]
    CAP[capabilities.ts] --> CMD[commands/]
    FN[functions.ts] --> CAP
    CMD --> DOM[domain/ · pure]
    CMD --> INF[infrastructure/ · SQL]
  end
  S --> FN
  M --> CAP
  INF --> DB[(Postgres · RLS by organization)]
```

| Concern           | Where                        | From kete-core                       |
| ----------------- | ---------------------------- | ------------------------------------ |
| Sign-in           | `platform/session.ts`        | `@kete/auth` (Compte Kete)           |
| Organization data | `platform/db.ts`             | `@kete/tenancy` (RLS)                |
| Rights            | `platform/rights.ts`         | `@kete/capabilities`, `@kete/center` |
| The center        | `platform/center.ts`         | `@kete/center` (Kete Enterprise)     |
| Gestures, journal | `features/*/commands`        | `@kete/commands`                     |
| Agents, drafts    | `platform/registry.ts`       | `@kete/capabilities`, `@kete/drafts` |
| Copilots          | `platform/mcp.ts`            | `@kete/capabilities`, `@kete/views`  |
| E-mails, jobs     | `platform/jobs.ts`           | `@kete/notify`, `@kete/jobs`         |
| Events, manifest  | `platform/events.ts`         | `@kete/sdk`                          |
| Feedback          | `lib/shell.tsx`, `/api/avis` | `@kete/feedback`                     |
| Journal           | `/journal`, `lib/journal.ts` | `@kete/admin` (audit)                |
| Design            | `platform/app.ts`, `styles/` | `@kete/design`                       |
| Amounts           | `features/*/domain`          | `@kete/money`                        |
| Document numbers  | `features/*/commands`        | `@kete/sequences`                    |
| Facts of money    | `features/register`          | `@kete/center`, `money-fact.v1`      |

## The center is told after the gesture

A gesture commits in the app first. Then `platform/sync.ts` asks the center for what it has not
heard — the project of a won quote, the facts of money — with the token of who acted. What the
center does not take waits in the app and travels with the next gesture: the center being away
never stops the work (`docs/flows/a-won-quote-opens-its-project.md`,
`src/features/register/README.md`).
