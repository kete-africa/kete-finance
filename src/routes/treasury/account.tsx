import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  InfoNote,
  PageHeader,
  Panel,
  SelectField,
  Tag,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  closeTill,
  fetchAccount,
  recordMovement,
  transferMoney,
} from '@/features/treasury/functions';
import { kindLabel } from '@/features/treasury/ui/labels';
import { sayError } from '@/lib/errors';
import { shown, typed } from '@/lib/money';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tresorerie/$accountId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchAccount({ data: { accountId: params.accountId } }),
  component: AccountPage,
});

function AccountPage() {
  const { account, accounts, movements, closings, may, currency } = Route.useLoaderData();
  const router = useRouter();
  const day = new Date().toISOString().slice(0, 10);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [on, setOn] = useState(day);
  const [to, setTo] = useState('');
  const [carried, setCarried] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');

  if (!account) {
    return (
      <AppShell>
        <EmptyState title={m.account_not_found()} />
      </AppShell>
    );
  }

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
  const moved = typed(amount, currency);
  const carrying = typed(carried, currency);
  const inDrawer = typed(counted, currency);
  const others = accounts.filter((one) => one.active && one.accountId !== account.accountId);
  const closedToday = account.closedOn !== null && account.closedOn >= day;

  return (
    <AppShell>
      <PageHeader
        breadcrumbLabel={m.breadcrumb_label()}
        breadcrumbs={[{ label: m.treasury_title(), href: '/tresorerie' }, { label: account.name }]}
        title={account.name}
        status={<Tag tone="neutral">{kindLabel(account.kind)}</Tag>}
        description={m.account_balance_now({ balance: shown(account.balance, currency) })}
      />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>
        {account.closedOn && (
          <InfoNote>{m.till_closed_until({ day: account.closedOn })}</InfoNote>
        )}

        <DataTable
          caption={m.movements_title()}
          rows={movements}
          rowKey={(movement) => movement.movementId}
          empty={<EmptyState title={m.movements_empty()} />}
          columns={[
            { key: 'on', label: m.doc_date(), render: (movement) => movement.on },
            { key: 'label', label: m.movement_label(), render: (movement) => movement.label },
            {
              key: 'in',
              label: m.movement_in(),
              align: 'end',
              render: (movement) =>
                movement.direction === 'in' ? shown(movement.amount, currency) : '',
            },
            {
              key: 'out',
              label: m.movement_out(),
              align: 'end',
              render: (movement) =>
                movement.direction === 'out' ? shown(movement.amount, currency) : '',
            },
          ]}
        />

        {account.kind === 'till' && (
          <Panel title={m.till_close_title()}>
            <div className="flex flex-col gap-4">
              <p className="text-fg-muted">
                {m.till_close_intro({ expected: shown(account.balance, currency) })}
              </p>
              {may.close && !closedToday && (
                <form
                  className="grid items-end gap-3 sm:grid-cols-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (inDrawer === null) return;
                    run(
                      () =>
                        closeTill({
                          data: {
                            accountId: account.accountId,
                            closedOn: day,
                            counted: inDrawer,
                            ...(note.trim() ? { note: note.trim() } : {}),
                          },
                        }),
                      () => {
                        setCounted('');
                        setNote('');
                      },
                    );
                  }}
                >
                  <TextField
                    label={m.till_counted()}
                    hint={m.till_counted_hint()}
                    value={counted}
                    inputMode="decimal"
                    required
                    onChange={(event) => setCounted(event.target.value)}
                  />
                  <TextField
                    className="sm:col-span-2"
                    label={m.till_note()}
                    hint={m.till_note_hint()}
                    value={note}
                    maxLength={500}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Button type="submit" disabled={busy || inDrawer === null}>
                    {m.till_close()}
                  </Button>
                </form>
              )}
              <DataTable
                caption={m.till_closings()}
                rows={closings}
                rowKey={(closing) => closing.closingId}
                empty={<p className="text-fg-muted">{m.till_closings_empty()}</p>}
                columns={[
                  { key: 'day', label: m.doc_date(), render: (closing) => closing.closedOn },
                  {
                    key: 'expected',
                    label: m.till_expected(),
                    align: 'end',
                    render: (closing) => shown(closing.expected, currency),
                  },
                  {
                    key: 'counted',
                    label: m.till_counted(),
                    align: 'end',
                    render: (closing) => shown(closing.counted, currency),
                  },
                  {
                    key: 'difference',
                    label: m.till_difference(),
                    align: 'end',
                    render: (closing) =>
                      closing.difference === 0 ? (
                        <Tag tone="validated">{m.till_exact()}</Tag>
                      ) : (
                        <Tag tone="error">
                          {`${closing.difference > 0 ? '+' : '−'} ${shown(Math.abs(closing.difference), currency)}`}
                        </Tag>
                      ),
                  },
                  { key: 'note', label: m.till_note(), render: (closing) => closing.note ?? '' },
                ]}
              />
            </div>
          </Panel>
        )}

        {may.manage && (
          <>
            <Panel title={m.movement_record_title()}>
              <form
                className="grid items-end gap-3 sm:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!moved) return;
                  run(
                    () =>
                      recordMovement({
                        data: {
                          accountId: account.accountId,
                          direction,
                          amount: moved,
                          on,
                          label: label.trim(),
                        },
                      }),
                    () => {
                      setAmount('');
                      setLabel('');
                    },
                  );
                }}
              >
                <SelectField
                  label={m.movement_direction()}
                  value={direction}
                  options={[
                    { value: 'out', label: m.movement_out() },
                    { value: 'in', label: m.movement_in() },
                  ]}
                  onChange={(event) => setDirection(event.target.value as 'in' | 'out')}
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
                  value={on}
                  required
                  onChange={(event) => setOn(event.target.value)}
                />
                <TextField
                  label={m.movement_label()}
                  hint={m.movement_label_hint()}
                  value={label}
                  required
                  maxLength={300}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <Button type="submit" disabled={busy || !moved || label.trim() === ''}>
                  {m.movement_record()}
                </Button>
              </form>
            </Panel>
            {others.length > 0 && (
              <Panel title={m.transfer_title()}>
                <form
                  className="grid items-end gap-3 sm:grid-cols-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!carrying || !to) return;
                    run(
                      () =>
                        transferMoney({
                          data: {
                            fromAccountId: account.accountId,
                            toAccountId: to,
                            amount: carrying,
                            on: day,
                          },
                        }),
                      () => setCarried(''),
                    );
                  }}
                >
                  <SelectField
                    className="sm:col-span-2"
                    label={m.transfer_to()}
                    value={to}
                    required
                    options={[
                      { value: '', label: m.movement_account_choose() },
                      ...others.map((one) => ({ value: one.accountId, label: one.name })),
                    ]}
                    onChange={(event) => setTo(event.target.value)}
                  />
                  <TextField
                    label={m.receipt_amount()}
                    value={carried}
                    inputMode="decimal"
                    required
                    onChange={(event) => setCarried(event.target.value)}
                  />
                  <Button type="submit" disabled={busy || !carrying || !to}>
                    {m.transfer_carry()}
                  </Button>
                </form>
              </Panel>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
