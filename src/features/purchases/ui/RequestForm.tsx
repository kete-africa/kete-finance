import { Button, ErrorNote, Facts, InfoNote, Panel, SelectField, TextField } from '@kete/design';
import { useEffect, useState } from 'react';
import { quantityOf, shown, typed } from '@/lib/money';
import * as m from '@/paraglide/messages.js';
import { amountOf } from '../domain/amount';
import { recallPrices, searchSuppliers } from '../functions';
import type { Advance } from '../purchase.record';

// The form of a purchase request and of an expense note: what, for which project and which post
// of its budget, and — as she types a line — what the thing was last bought for.

interface LineDraft {
  label: string;
  quantity: string;
  unitPrice: string;
}

export interface RequestWritten {
  title: string;
  partyId?: string;
  partyName?: string;
  projectId?: string;
  post?: string;
  lines: { label: string; quantity: number; unitPrice: number }[];
  spentOn?: string;
  proof?: string;
  advanceId?: string;
}

interface Recalled {
  label: string;
  unitPrice: number;
  supplier: string | null;
  on: string;
  currency: string;
}

const emptyLine = (): LineDraft => ({ label: '', quantity: '1', unitPrice: '' });

export function RequestForm({
  kind,
  currency,
  connected,
  projects,
  advances = [],
  start,
  submitLabel,
  onSubmit,
}: {
  kind: 'purchase' | 'expense';
  currency: string;
  connected: boolean;
  projects: { projectId: string; name: string; posts: { name: string; budget: number }[] }[];
  /** Her open advances: an expense note may justify one. */
  advances?: Advance[];
  /** A request sent back, to correct. */
  start?: {
    title: string;
    partyId: string | null;
    partyName: string | null;
    projectId: string | null;
    post: string | null;
    lines: { label: string; quantity: number; unitPrice: number }[];
  };
  submitLabel: string;
  onSubmit(request: RequestWritten): Promise<string | null>;
}) {
  const [title, setTitle] = useState(start?.title ?? '');
  const [party, setParty] = useState({ id: start?.partyId ?? null, name: start?.partyName ?? '' });
  const [found, setFound] = useState<{ partyId: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState(start?.projectId ?? '');
  const [post, setPost] = useState(start?.post ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    start?.lines.map((line) => ({
      label: line.label,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
    })) ?? [emptyLine()],
  );
  const [recalled, setRecalled] = useState<Record<number, Recalled[]>>({});
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [proof, setProof] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'purchase' || !connected || party.id || party.name.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchSuppliers({ data: { text: party.name } })
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [kind, connected, party.id, party.name]);

  const project = projects.find((one) => one.projectId === projectId);
  const read = lines.map((line) => ({
    label: line.label.trim(),
    quantity: quantityOf(line.quantity),
    unitPrice: typed(line.unitPrice, currency),
  }));
  const complete = read.every(
    (line) => line.label !== '' && line.quantity !== null && line.unitPrice !== null,
  );
  // The same arithmetic as the server's: each line rounded once, then added.
  const total = amountOf(
    read.map((line) => ({
      label: line.label,
      quantity: line.quantity ?? 0,
      unitPrice: line.unitPrice ?? 0,
    })),
    currency,
  );
  const ready =
    title.trim() !== '' && complete && total > 0 && (projectId === '' || post.trim() !== '');

  const change = (index: number, patch: Partial<LineDraft>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const recall = (index: number, label: string) => {
    if (kind !== 'purchase' || label.trim().length < 2) return;
    void recallPrices({ data: { text: label.trim() } })
      .then((prices) => setRecalled((before) => ({ ...before, [index]: prices })))
      .catch(() => undefined);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        void onSubmit({
          title: title.trim(),
          ...(kind === 'purchase' && party.id ? { partyId: party.id } : {}),
          ...(kind === 'purchase' && party.name.trim() ? { partyName: party.name.trim() } : {}),
          ...(projectId ? { projectId, post: post.trim() } : {}),
          lines: read.map((line) => ({
            label: line.label,
            quantity: line.quantity ?? 1,
            unitPrice: line.unitPrice ?? 0,
          })),
          ...(kind === 'expense' ? { spentOn } : {}),
          ...(kind === 'expense' && proof.trim() ? { proof: proof.trim() } : {}),
          ...(kind === 'expense' && advanceId ? { advanceId } : {}),
        })
          .then(setError)
          .finally(() => setBusy(false));
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={m.request_title_label()}
            value={title}
            required
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          {kind === 'purchase' ? (
            <div className="flex flex-col gap-2">
              <TextField
                label={m.request_supplier_label()}
                value={party.name}
                maxLength={200}
                hint={party.id ? m.party_from_center() : m.request_supplier_hint()}
                onChange={(event) => setParty({ id: null, name: event.target.value })}
              />
              {found.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label={m.party_found()}>
                  {found.map((one) => (
                    <li key={one.partyId}>
                      <Button
                        variant="secondary"
                        onClick={() => setParty({ id: one.partyId, name: one.name })}
                      >
                        {one.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <TextField
              label={m.expense_spent_on()}
              type="date"
              value={spentOn}
              required
              onChange={(event) => setSpentOn(event.target.value)}
            />
          )}
          <SelectField
            label={m.invoice_project_label()}
            hint={connected ? m.request_project_hint() : m.request_project_alone()}
            value={projectId}
            options={[
              { value: '', label: m.project_none() },
              ...projects.map((one) => ({ value: one.projectId, label: one.name })),
            ]}
            onChange={(event) => {
              setProjectId(event.target.value);
              setPost('');
            }}
          />
          {project && (
            <SelectField
              label={m.line_post()}
              hint={m.request_post_hint()}
              value={post}
              required
              options={[
                { value: '', label: m.request_post_choose() },
                ...project.posts.map((one) => ({
                  value: one.name,
                  label: m.request_post_option({
                    name: one.name,
                    budget: shown(one.budget, currency),
                  }),
                })),
              ]}
              onChange={(event) => setPost(event.target.value)}
            />
          )}
          {kind === 'expense' && (
            <>
              <TextField
                label={m.expense_proof()}
                hint={m.expense_proof_hint()}
                value={proof}
                maxLength={200}
                onChange={(event) => setProof(event.target.value)}
              />
              {advances.length > 0 && (
                <SelectField
                  label={m.expense_advance()}
                  hint={m.expense_advance_hint()}
                  value={advanceId}
                  options={[
                    { value: '', label: m.expense_advance_none() },
                    ...advances.map((advance) => ({
                      value: advance.advanceId,
                      label: m.expense_advance_option({
                        number: advance.number,
                        left: shown(
                          advance.amount - advance.justified - advance.returned,
                          advance.currency,
                        ),
                      }),
                    })),
                  ]}
                  onChange={(event) => setAdvanceId(event.target.value)}
                />
              )}
            </>
          )}
        </div>
      </Panel>

      <Panel title={m.lines_title()}>
        <div className="flex flex-col gap-4">
          {lines.map((line, index) => (
            <div key={index} className="flex flex-col gap-2 border-b border-line pb-4">
              <div className="grid items-end gap-3 sm:grid-cols-12">
                <TextField
                  className="sm:col-span-6"
                  label={m.line_label()}
                  value={line.label}
                  required
                  maxLength={200}
                  onChange={(event) => change(index, { label: event.target.value })}
                  onBlur={(event) => recall(index, event.target.value)}
                />
                <TextField
                  className="sm:col-span-2"
                  label={m.line_quantity()}
                  value={line.quantity}
                  inputMode="decimal"
                  onChange={(event) => change(index, { quantity: event.target.value })}
                />
                <TextField
                  className="sm:col-span-2"
                  label={m.line_unit_price()}
                  value={line.unitPrice}
                  inputMode="decimal"
                  onChange={(event) => change(index, { unitPrice: event.target.value })}
                />
                <Button
                  className="sm:col-span-2"
                  variant="secondary"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                >
                  {m.line_remove()}
                </Button>
              </div>
              {(recalled[index] ?? []).length > 0 && (
                <InfoNote>
                  {m.prices_recalled()}{' '}
                  {(recalled[index] ?? [])
                    .map((price) =>
                      m.price_recalled({
                        price: shown(price.unitPrice, price.currency),
                        supplier: price.supplier ?? m.price_no_supplier(),
                        on: price.on,
                      }),
                    )
                    .join(' · ')}
                </InfoNote>
              )}
            </div>
          ))}
          <div>
            <Button variant="secondary" onClick={() => setLines([...lines, emptyLine()])}>
              {m.line_add()}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title={m.totals_title()}>
        <Facts items={[{ label: m.request_amount(), value: shown(total, currency) }]} />
      </Panel>

      <ErrorNote>{error}</ErrorNote>
      <div>
        <Button type="submit" disabled={busy || !ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
