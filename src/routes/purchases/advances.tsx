import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  Panel,
  SelectField,
  Tag,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchAdvances, giveAdvance, returnAdvance } from '@/features/purchases/functions';
import { PurchasesFrame } from '@/features/purchases/ui/PurchasesFrame';
import { receiptMethods, type ReceiptMethod } from '@/features/sales/methods';
import { sayError } from '@/lib/errors';
import { shown, typed } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/achats/avances')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchAdvances(),
  component: AdvancesPage,
});

const methodLabel = (method: ReceiptMethod) =>
  ({
    cash: m.method_cash,
    bank: m.method_bank,
    mobile: m.method_mobile,
    cheque: m.method_cheque,
  })[method]();

function AdvancesPage() {
  const { advances, currency, may, projects, people } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [holderId, setHolderId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [givenOn, setGivenOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [reference, setReference] = useState('');
  const [returning, setReturning] = useState<Record<string, string>>({});

  // Whom an advance may be given to: the project's team, or who is already known here.
  const team = projects.find((project) => project.projectId === projectId)?.team ?? [];
  const candidates = team.length > 0 ? team : people;
  const holder = candidates.find((person) => person.userId === holderId);
  const given = typed(amount, currency);

  const run = (work: () => Promise<{ ok: true } | { ok: false; code: string }>, then?: () => void) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (outcome) => {
        if (!outcome.ok) return setError(sayError(outcome.code));
        then?.();
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };

  return (
    <PurchasesFrame current="advances" title={m.advances_title()} description={m.advances_intro()}>
      <ErrorNote>{error}</ErrorNote>
      <DataTable
        caption={m.advances_title()}
        rows={advances}
        rowKey={(advance) => advance.advanceId}
        empty={<EmptyState title={m.advances_empty()} />}
        columns={[
          { key: 'number', label: m.doc_number(), render: (advance) => advance.number },
          { key: 'holder', label: m.advance_holder(), render: (advance) => advance.holder.name },
          { key: 'purpose', label: m.advance_purpose(), render: (advance) => advance.purpose },
          {
            key: 'project',
            label: m.invoice_project_label(),
            render: (advance) => advance.projectName ?? m.project_running(),
          },
          {
            key: 'amount',
            label: m.advance_given(),
            align: 'end',
            render: (advance) => shown(advance.amount, advance.currency),
          },
          {
            key: 'justified',
            label: m.advance_justified(),
            align: 'end',
            render: (advance) => shown(advance.justified, advance.currency),
          },
          {
            key: 'left',
            label: m.advance_left(),
            align: 'end',
            render: (advance) =>
              shown(advance.amount - advance.justified - advance.returned, advance.currency),
          },
          {
            key: 'status',
            label: m.doc_status(),
            render: (advance) =>
              advance.status === 'closed' ? (
                <Tag tone="neutral">{m.advance_closed()}</Tag>
              ) : may.pay ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const back = typed(returning[advance.advanceId] ?? '', advance.currency);
                    if (!back) return;
                    run(
                      () =>
                        returnAdvance({
                          data: {
                            advanceId: advance.advanceId,
                            amount: back,
                            returnedOn: new Date().toISOString().slice(0, 10),
                          },
                        }),
                      () => setReturning({ ...returning, [advance.advanceId]: '' }),
                    );
                  }}
                >
                  <input
                    className="h-(--control-height) w-28 rounded-control border border-line-control bg-surface-control px-2"
                    aria-label={m.advance_return_amount()}
                    inputMode="decimal"
                    value={returning[advance.advanceId] ?? ''}
                    onChange={(event) =>
                      setReturning({ ...returning, [advance.advanceId]: event.target.value })
                    }
                  />
                  <Button type="submit" variant="secondary" disabled={busy}>
                    {m.advance_return()}
                  </Button>
                </form>
              ) : (
                <Tag tone="verify">{m.advance_open()}</Tag>
              ),
          },
        ]}
      />

      {may.pay && (
        <Panel title={m.advance_give_title()}>
          <form
            className="grid items-end gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!holder || !given) return;
              run(
                () =>
                  giveAdvance({
                    data: {
                      holderId: holder.userId,
                      holderName: holder.name,
                      purpose: purpose.trim(),
                      ...(projectId ? { projectId } : {}),
                      amount: given,
                      givenOn,
                      method,
                      ...(reference.trim() ? { reference: reference.trim() } : {}),
                    },
                  }),
                () => {
                  setPurpose('');
                  setAmount('');
                  setReference('');
                },
              );
            }}
          >
            <SelectField
              label={m.invoice_project_label()}
              value={projectId}
              options={[
                { value: '', label: m.project_none() },
                ...projects.map((project) => ({ value: project.projectId, label: project.name })),
              ]}
              onChange={(event) => {
                setProjectId(event.target.value);
                setHolderId('');
              }}
            />
            <SelectField
              label={m.advance_holder()}
              hint={m.advance_holder_hint()}
              value={holderId}
              required
              options={[
                { value: '', label: m.advance_holder_choose() },
                ...candidates.map((person) => ({ value: person.userId, label: person.name })),
              ]}
              onChange={(event) => setHolderId(event.target.value)}
            />
            <TextField
              className="sm:col-span-2"
              label={m.advance_purpose()}
              value={purpose}
              required
              maxLength={200}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <TextField
              label={m.receipt_amount()}
              value={amount}
              inputMode="decimal"
              required
              onChange={(event) => setAmount(event.target.value)}
            />
            <TextField
              label={m.doc_date()}
              type="date"
              value={givenOn}
              required
              onChange={(event) => setGivenOn(event.target.value)}
            />
            <SelectField
              label={m.receipt_method()}
              value={method}
              options={receiptMethods.map((value) => ({ value, label: methodLabel(value) }))}
              onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
            />
            <TextField
              label={m.receipt_reference()}
              value={reference}
              maxLength={120}
              onChange={(event) => setReference(event.target.value)}
            />
            <div className="sm:col-span-4">
              <Button type="submit" disabled={busy || !holder || !given || purpose.trim() === ''}>
                {m.advance_give()}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </PurchasesFrame>
  );
}
