import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  InfoNote,
  KpiGrid,
  KpiTile,
  PageHeader,
  Panel,
  SelectField,
  Tag,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { accountKinds, type AccountKind } from '@/features/treasury/domain/kinds';
import { assignMovement, fetchTreasury, openAccount } from '@/features/treasury/functions';
import { kindLabel } from '@/features/treasury/ui/labels';
import { sayError } from '@/lib/errors';
import { shown, typed } from '@/lib/money';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tresorerie')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchTreasury(),
  component: TreasuryPage,
});

function TreasuryPage() {
  const treasury = Route.useLoaderData();
  const router = useRouter();
  const { currency } = treasury;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [opening, setOpening] = useState('0');
  const [openedOn, setOpenedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [assigned, setAssigned] = useState<Record<string, string>>({});

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
  const openingAmount = typed(opening, currency);

  return (
    <AppShell>
      <PageHeader title={m.treasury_title()} description={m.treasury_intro()} />
      <div className="flex flex-col gap-6">
        <ErrorNote>{error}</ErrorNote>
        <KpiGrid label={m.treasury_title()}>
          <KpiTile
            label={m.money_held()}
            value={shown(treasury.held, currency)}
            hint={m.money_held_hint()}
          />
          <KpiTile
            label={m.money_reserved()}
            value={shown(treasury.reserved, currency)}
            hint={m.money_reserved_hint()}
          />
          <KpiTile
            label={m.money_committed()}
            value={shown(treasury.committed, currency)}
            hint={m.money_committed_hint()}
          />
          <KpiTile
            label={m.money_available()}
            value={shown(treasury.available, currency)}
            hint={m.money_available_hint()}
          />
        </KpiGrid>
        {treasury.available < 0 && (
          <InfoNote>
            {m.money_short({ amount: shown(-treasury.available, currency) })}
          </InfoNote>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-title font-semibold">{m.accounts_title()}</h2>
          <DataTable
            caption={m.accounts_title()}
            rows={treasury.accounts}
            rowKey={(account) => account.accountId}
            rowHref={(account) => `/tresorerie/${account.accountId}`}
            empty={<EmptyState title={m.accounts_empty()}>{m.accounts_empty_body()}</EmptyState>}
            columns={[
              { key: 'name', label: m.account_name(), render: (account) => account.name },
              { key: 'kind', label: m.account_kind(), render: (account) => kindLabel(account.kind) },
              {
                key: 'closed',
                label: m.account_closed_on(),
                render: (account) => account.closedOn ?? '—',
              },
              {
                key: 'balance',
                label: m.account_balance(),
                align: 'end',
                render: (account) => shown(account.balance, account.currency),
              },
            ]}
          />
        </section>

        {treasury.waiting.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-title font-semibold">{m.movements_waiting_title()}</h2>
            <InfoNote>{m.movements_waiting_note()}</InfoNote>
            <DataTable
              caption={m.movements_waiting_title()}
              rows={treasury.waiting}
              rowKey={(movement) => movement.movementId}
              columns={[
                { key: 'on', label: m.doc_date(), render: (movement) => movement.on },
                { key: 'label', label: m.movement_label(), render: (movement) => movement.label },
                {
                  key: 'amount',
                  label: m.receipt_amount(),
                  align: 'end',
                  render: (movement) =>
                    `${movement.direction === 'out' ? '−' : '+'} ${shown(movement.amount, currency)}`,
                },
                {
                  key: 'assign',
                  label: m.movement_account(),
                  render: (movement) =>
                    treasury.may.manage ? (
                      <span className="flex items-center gap-2">
                        <select
                          className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-2"
                          aria-label={m.movement_account()}
                          value={assigned[movement.movementId] ?? ''}
                          onChange={(event) =>
                            setAssigned({ ...assigned, [movement.movementId]: event.target.value })
                          }
                        >
                          <option value="">{m.movement_account_choose()}</option>
                          {treasury.accounts
                            .filter((account) => account.active)
                            .map((account) => (
                              <option key={account.accountId} value={account.accountId}>
                                {account.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          variant="secondary"
                          disabled={busy || !assigned[movement.movementId]}
                          onClick={() =>
                            run(() =>
                              assignMovement({
                                data: {
                                  movementId: movement.movementId,
                                  accountId: assigned[movement.movementId] ?? '',
                                },
                              }),
                            )
                          }
                        >
                          {m.movement_assign()}
                        </Button>
                      </span>
                    ) : (
                      <Tag tone="verify">{m.movement_waiting()}</Tag>
                    ),
                },
              ]}
            />
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-title font-semibold">{m.funds_title()}</h2>
          <p className="text-fg-muted">{m.funds_intro()}</p>
          <DataTable
            caption={m.funds_title()}
            rows={treasury.projects}
            rowKey={(project) => project.projectId}
            empty={<EmptyState title={m.funds_empty()} />}
            columns={[
              { key: 'name', label: m.invoice_project_label(), render: (project) => project.name },
              {
                key: 'received',
                label: m.funds_received(),
                align: 'end',
                render: (project) => shown(project.received, currency),
              },
              {
                key: 'spent',
                label: m.funds_spent(),
                align: 'end',
                render: (project) => shown(project.spent, currency),
              },
              {
                key: 'available',
                label: m.funds_available(),
                align: 'end',
                render: (project) => shown(project.available, currency),
              },
              {
                key: 'committed',
                label: m.funds_committed(),
                align: 'end',
                render: (project) => shown(project.committed, currency),
              },
              {
                key: 'state',
                label: m.doc_status(),
                render: (project) =>
                  project.overdrawn > 0 ? (
                    <Tag tone="error">
                      {m.funds_overdrawn({ amount: shown(project.overdrawn, currency) })}
                    </Tag>
                  ) : project.uncovered > 0 ? (
                    <Tag tone="verify">
                      {m.funds_uncovered({ amount: shown(project.uncovered, currency) })}
                    </Tag>
                  ) : (
                    <Tag tone="validated">{m.funds_covered()}</Tag>
                  ),
              },
            ]}
          />
          <p className="text-body-sm text-fg-muted">
            {m.funds_running({
              received: shown(treasury.running.received, currency),
              spent: shown(treasury.running.spent, currency),
              committed: shown(treasury.running.committed, currency),
            })}
          </p>
        </section>

        {treasury.may.manage && (
          <Panel title={m.account_open_title()}>
            <form
              className="grid items-end gap-3 sm:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (openingAmount === null) return;
                run(
                  () =>
                    openAccount({
                      data: { name: name.trim(), kind, opening: openingAmount, openedOn },
                    }),
                  () => {
                    setName('');
                    setOpening('0');
                  },
                );
              }}
            >
              <TextField
                className="sm:col-span-2"
                label={m.account_name()}
                value={name}
                required
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
              <SelectField
                label={m.account_kind()}
                value={kind}
                options={accountKinds.map((value) => ({ value, label: kindLabel(value) }))}
                onChange={(event) => setKind(event.target.value as AccountKind)}
              />
              <TextField
                label={m.account_opening()}
                hint={m.account_opening_hint()}
                value={opening}
                inputMode="decimal"
                onChange={(event) => setOpening(event.target.value)}
              />
              <TextField
                label={m.account_opened_on()}
                type="date"
                value={openedOn}
                required
                onChange={(event) => setOpenedOn(event.target.value)}
              />
              <div className="sm:col-span-5">
                <Button type="submit" disabled={busy || name.trim() === '' || openingAmount === null}>
                  {m.account_open()}
                </Button>
              </div>
            </form>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
