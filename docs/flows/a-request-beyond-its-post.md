# A request beyond its post goes up the circuit

```mermaid
sequenceDiagram
  participant K as Kofi (asks)
  participant G as Gestion
  participant E as Kete Enterprise
  participant D as Who the circuit finds
  K->>G: purchases_ask — 1 500 000 on « Matériel » of his project
  G->>E: GET /v1/projects/:id (his token): the posts of the budget
  G->>G: 1 530 000 − 120 000 committed = 1 410 000 left: 90 000 beyond
  G->>E: POST /v1/apps/prd_kete_gestion/decisions — subject beyond_budget, the project, the amount
  E->>D: in her Inbox: « DA-2026-0002 — … (dépasse le poste « Matériel » de 90 000 F CFA) »
  D->>E: sent back: « Négociez le prix »
  E->>G: POST /api/centre/decisions — the request's id only
  G->>E: GET /public/apps/:org/decisions/:id (the app's own token)
  G->>G: settle-request: returned, with the reason
  K->>G: purchases_correct — 1 400 000
  G->>E: asked again, same subject and reference: the same request
  D->>E: approved
  E->>G: told, read, applied: committed 1 400 000 on « Matériel »
```

- The standing of a request is computed in the transaction that writes it; the decision is asked
  after it commits, with the token of who asked.
- Without a circuit for `beyond_budget` the ordinary one decides; without any, or without a
  center, who holds `purchases:approve` decides here — never who asked.
- The center's message carries no decision: the app reads it, as itself.
