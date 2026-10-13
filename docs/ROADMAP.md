# Roadmap

The steps of Kete Gestion. Each closes on a proof: a test that names it, and — when a screen
exists — what was seen in the demonstration. « Built » is not « proven with a real company »:
nothing here has been used by one yet.

| Step | Branch          | What it gives                                                                                              | Proof                                                   | State        |
| ---- | --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------ |
| G1   | `001-sales`     | Quotes with their cost, invoices numbered without a gap, money received, a won quote's project             | « A won quote becomes a project with its budget »       | Built        |
| G2   | `002-purchases` | Purchase requests with their project and post, expense notes, advances, the memory of prices               | « A request beyond its post goes up the circuit »       | Next         |
| G3   | `003-treasury`  | Accounts and tills, the three states of money, the funds of each project, the till closed every day        | « Really available » is the bank less reserved and committed | After G2     |

## What every step rests on

- **The register of money** (`src/features/register`): every fact once under its key — invoiced,
  received, committed, spent — with its project and its budget post, told to the center.
- **The center's references**: third parties and projects are read at Kete Enterprise
  (`@kete/center`); a won quote opens its project there.
- **kete-core**: `@kete/money` (amounts that never lose a unit), `@kete/sequences` (numbers
  without a gap), the contract `money-fact.v1`.

## What waits

- A real model, real documents (a statement, receipts, a supplier's invoice): reading a photo into
  a draft is kete-core's step E4, then used here in G2.
- A printable quote and invoice with the company's letterhead and legal mentions; credit notes.
- Value-added tax owed to the state: documents carry their tax, nothing tracks what is to hand
  back.
- A deployment: nothing runs anywhere but on the workshop's machine and in the tests.
