import { Button, ErrorNote, Facts, Panel, SelectField, TextField } from '@kete/design';
import { useEffect, useState } from 'react';
import { quantityOf, shown, typed } from '@/lib/money';
import * as m from '@/paraglide/messages.js';
import { totalsOf } from '../domain/totals';
import { searchParties } from '../functions';

// The form of a quote, and of an invoice without a quote: who it is for, its lines, and its
// totals computed as she types — by the same arithmetic the server uses.

interface LineDraft {
  label: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  post: string;
}

export interface DocumentWritten {
  title: string;
  partyId?: string;
  partyName: string;
  taxRate: number;
  validUntil?: string;
  projectId?: string;
  lines: { label: string; quantity: number; unitPrice: number; unitCost: number; post: string }[];
}

export interface DocumentStart {
  title: string;
  partyId: string | null;
  partyName: string;
  taxRate: number;
  validUntil: string | null;
  lines: { label: string; quantity: number; unitPrice: number; unitCost: number; post: string }[];
}

const emptyLine = (): LineDraft => ({
  label: '',
  quantity: '1',
  unitPrice: '',
  unitCost: '',
  post: '',
});

export function DocumentForm({
  kind,
  currency,
  connected,
  start,
  projects,
  submitLabel,
  onSubmit,
}: {
  /** A quote plans its cost, post by post; an invoice only says what is sold. */
  kind: 'quote' | 'invoice';
  currency: string;
  /** Whether the center gives its third parties: a client is then picked, not retyped. */
  connected: boolean;
  start?: DocumentStart;
  /** The projects an invoice without a quote may belong to. */
  projects?: { projectId: string; name: string }[];
  submitLabel: string;
  onSubmit(document: DocumentWritten): Promise<string | null>;
}) {
  const [title, setTitle] = useState(start?.title ?? '');
  const [party, setParty] = useState({ id: start?.partyId ?? null, name: start?.partyName ?? '' });
  const [found, setFound] = useState<{ partyId: string; name: string }[]>([]);
  const [taxRate, setTaxRate] = useState(String(start?.taxRate ?? 0));
  const [validUntil, setValidUntil] = useState(start?.validUntil ?? '');
  const [projectId, setProjectId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(
    start?.lines.map((line) => ({
      label: line.label,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      unitCost: line.unitCost ? String(line.unitCost) : '',
      post: line.post,
    })) ?? [emptyLine()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The center's third parties matching what she types, a moment after she stops.
  useEffect(() => {
    if (!connected || party.id || party.name.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchParties({ data: { text: party.name } })
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [connected, party.id, party.name]);

  const withCost = kind === 'quote';
  const read = lines.map((line) => ({
    label: line.label.trim(),
    quantity: quantityOf(line.quantity),
    unitPrice: typed(line.unitPrice, currency),
    unitCost: line.unitCost.trim() === '' ? 0 : typed(line.unitCost, currency),
    post: line.post.trim() || m.post_default(),
  }));
  const complete = read.every(
    (line) =>
      line.label !== '' && line.quantity !== null && line.unitPrice !== null && line.unitCost !== null,
  );
  const rate = Number(taxRate.replace(',', '.'));
  const rateOk = Number.isFinite(rate) && rate >= 0 && rate <= 100;
  const written = read.map((line) => ({
    label: line.label,
    quantity: line.quantity ?? 1,
    unitPrice: line.unitPrice ?? 0,
    unitCost: line.unitCost ?? 0,
    post: line.post,
  }));
  const totals = totalsOf(written, rateOk ? rate : 0, currency);
  const ready = title.trim() !== '' && party.name.trim() !== '' && complete && rateOk;

  const change = (index: number, patch: Partial<LineDraft>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

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
          ...(party.id ? { partyId: party.id } : {}),
          partyName: party.name.trim(),
          taxRate: rate,
          ...(validUntil ? { validUntil } : {}),
          ...(projectId ? { projectId } : {}),
          lines: written,
        })
          .then(setError)
          .finally(() => setBusy(false));
      }}
    >
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={m.quote_title_label()}
            value={title}
            required
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="flex flex-col gap-2">
            <TextField
              label={m.quote_party_label()}
              value={party.name}
              required
              maxLength={200}
              hint={
                party.id
                  ? m.party_from_center()
                  : connected
                    ? m.party_pick_hint()
                    : m.party_alone_hint()
              }
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
          <TextField
            label={m.quote_tax_label()}
            value={taxRate}
            inputMode="decimal"
            {...(rateOk ? {} : { error: m.errors_invalid_input() })}
            onChange={(event) => setTaxRate(event.target.value)}
          />
          {kind === 'quote' ? (
            <TextField
              label={m.quote_valid_label()}
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          ) : (
            <SelectField
              label={m.invoice_project_label()}
              hint={m.invoice_project_hint()}
              value={projectId}
              options={[
                { value: '', label: m.project_none() },
                ...(projects ?? []).map((p) => ({ value: p.projectId, label: p.name })),
              ]}
              onChange={(event) => setProjectId(event.target.value)}
            />
          )}
        </div>
      </Panel>

      <Panel title={m.lines_title()}>
        <div className="flex flex-col gap-4">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid items-end gap-3 border-b border-line pb-4 sm:grid-cols-12"
            >
              <TextField
                className={withCost ? 'sm:col-span-4' : 'sm:col-span-6'}
                label={m.line_label()}
                value={line.label}
                required
                maxLength={200}
                onChange={(event) => change(index, { label: event.target.value })}
              />
              <TextField
                className="sm:col-span-1"
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
              {withCost && (
                <>
                  <TextField
                    className="sm:col-span-2"
                    label={m.line_unit_cost()}
                    value={line.unitCost}
                    inputMode="decimal"
                    onChange={(event) => change(index, { unitCost: event.target.value })}
                  />
                  <TextField
                    className="sm:col-span-2"
                    label={m.line_post()}
                    value={line.post}
                    maxLength={80}
                    placeholder={m.post_default()}
                    onChange={(event) => change(index, { post: event.target.value })}
                  />
                </>
              )}
              <Button
                className={withCost ? 'sm:col-span-1' : 'sm:col-span-3'}
                variant="secondary"
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                {m.line_remove()}
              </Button>
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
        <Facts
          items={[
            { label: m.total_subtotal(), value: shown(totals.subtotal, currency) },
            { label: m.total_tax(), value: shown(totals.tax, currency) },
            { label: m.doc_total(), value: shown(totals.total, currency) },
            ...(withCost
              ? [
                  { label: m.total_cost(), value: shown(totals.cost, currency) },
                  { label: m.total_margin(), value: shown(totals.margin, currency) },
                ]
              : []),
          ]}
        />
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
