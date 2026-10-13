# Kete Finance — project context

> The single place where this app's context lives. `AGENTS.md` points here.

## What this app is

The money of a company, in one register, behind Kete Enterprise: **sales** (quotes, invoices,
money received), **purchases and expenses**, **treasury**. One of the four generic apps of the
doctrine (D-048). It requires the center for what it does not own: third parties and projects
(D-047). Every fact of money carries its project and its budget post, or counts in the running of
the organization (D-049).

What it never does: execute a payment, keep a general ledger, hold a client file or a project of
its own.

## Read before any action

1. The Kete doctrine (`kete-africa/kete`): `docs/PRINCIPES.md`, `docs/CONCEPTION.md`,
   `docs/ARCHITECTURE_APP.md`, `docs/DECISIONS.md` (D-047, D-048, D-049 for this app).
2. `docs/ROADMAP.md` — the steps of this app, what is built and what is proven.
3. `docs/ARCHITECTURE.md` and `docs/decisions/` — this app's architecture and decisions.
4. Each feature's `README.md` (`src/features/*/README.md`) and its spec (`specs/`).

## Layout

```
kete.json          the manifest (contract manifest.v1): product, version, events, and the
                   identity card (owner, data, AI, criticality), kept true as the app changes
src/routes.ts      every address, once: English files, French addresses
src/features/      one folder per feature: record, domain, commands, infrastructure,
                   capabilities, policies, events, datasets, functions, ui, README
  register/        the register of money: every fact once, told to the center
  sales/           quotes, invoices, receipts
  purchases/       purchase requests, expense notes, advances, the memory of prices
  treasury/        accounts and their movements, the three states of money, the tills' closings
src/platform/      the wiring, no business rule: sign-in, database, rights, registry, MCP,
                   events, jobs, e-mails, what the center is told after a gesture (sync.ts), and
                   whose request it is while a gesture runs (person.ts)
src/worker/        the worker role: e-mails, events (pg-boss)
db/migrations.ts   every table with its row-level security, in order
db/demo/           the demonstration's data, written through the app's own gestures
messages/          fr.json, en.json: no hard-coded string
specs/             one folder per step: what changes, what stays for later, the proof
tests/             every surface under the same rules
```

## Rules

- Every amount is an integer of the currency's smallest unit, computed by `@kete/money` — never a
  float, never a figure written by a model or summed on a screen.
- A document that leaves — an issued invoice — takes its number from `@kete/sequences`, in the
  transaction that writes it, and is never changed nor deleted afterwards.
- Money that comes in or goes out lands on its account in the transaction of the gesture that
  moves it (`moveMoney`). « Really available » is computed in one place
  (`treasury/domain/standing.ts`): held, less reserved for projects, less committed.
- Every fact of money is written in the register (`sayFact`) in the transaction of the gesture
  that makes it true, under a key of its own: said again, it replaces what was said.
- Who writes is not who issues, and who issues is not who holds the till; who asks never approves
  nor pays her own request: each gesture has its permission, and the commands refuse one's own.
- An expense on a project names the post of its budget, and is measured against what the post has
  left when it is asked. What goes beyond is said, and decided higher.
- Every gesture is a named command (@kete/commands), and every capability declares its autonomy
  (@kete/capabilities): an agent prepares, a person issues, pays and decides.
- Every table carries `organization_id` and its RLS policy in the same migration.
- No vendor name in a feature's domain or application layer: ports and adapters.
- No hard-coded user-visible string; no secret in a file, a message or a commit.
- A behavior change ships with its documentation and its diagram.

## Branches

```
main       production — the human gesture only
dev        integration
NNN-slug   one step, branched from dev, with its spec in specs/NNN-slug
```
