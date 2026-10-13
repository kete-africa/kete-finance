# A won quote opens its project

```mermaid
sequenceDiagram
  participant K as Kossi (sells)
  participant G as Gestion
  participant E as Kete Enterprise
  participant L as Mme Lawson (accounts)
  K->>G: quotes_win
  G->>G: win-quote, journaled
  G->>E: POST /v1/projects — name, client, sold, posts at cost, bornFrom: D-2026-0001
  E-->>G: the project (the same one if asked again)
  G->>G: attach-project: the quote, its invoices and their facts move to it
  K->>G: invoices_from_quote (30 %)
  L->>G: invoices_issue — F-2026-0001
  G->>E: POST /v1/money/facts — invoiced, what is still due, on the project
```

- The center is asked **after** the gesture commits, with the token of who acted: it answers
  within her rights. If it refuses her or is away, the quote stays won and its project waits for
  the next gesture of someone the center accepts — or for « Ouvrir le projet » on the quote.
- The budget is what the job is expected to **cost**, by post; the amount sold is the quote's
  total. What the project then spends against each post comes from purchases (step G2).
