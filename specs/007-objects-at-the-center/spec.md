# Spec 007 — Quotes, invoices and purchase requests in the center's index

Kete-core spec 142, Kete Enterprise spec 100; doctrine D-062, R1 and R15: every object is found and
cited where people work. Support says its tickets; Kete Finance now says its own.

## Requirements

- **FR-001 — Declared.** The manifest declares three kinds — `quote`, `invoice`, `purchase` —
  with their states in the order of their life (won, lost, paid, refused, cancelled close them),
  their axes (project, third party, person) and an invoice's link to the quote it bills.
- **FR-002 — Said.** With its holdings, the app says to its center each quote, invoice and
  purchase request still in progress, and those that changed in the last month: title, state,
  project, third party, who answers for it, where it opens. Their data stays here.

## Proof

`tests/model.test.ts`: the manifest and each kind pass their contracts; a quote sent is said with
its client and its seller, every object in the shape of `object.v1` with a state its kind declares.
