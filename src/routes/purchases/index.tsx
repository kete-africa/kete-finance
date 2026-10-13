import { Button, DataTable, EmptyState, KpiGrid, KpiTile } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchPurchasesHome } from '@/features/purchases/functions';
import type { PurchaseRequest } from '@/features/purchases/purchase.record';
import {
  kindLabel,
  PurchasesFrame,
  RequestStatus,
} from '@/features/purchases/ui/PurchasesFrame';
import { shown } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/achats')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchPurchasesHome(),
  component: PurchasesHome,
});

function Requests({
  title,
  rows,
  empty,
  showRequester = true,
}: {
  title: string;
  rows: PurchaseRequest[];
  empty?: string;
  showRequester?: boolean;
}) {
  if (rows.length === 0 && !empty) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-title font-semibold">{title}</h2>
      <DataTable
        caption={title}
        rows={rows}
        rowKey={(request) => request.requestId}
        rowHref={(request) => `/achats/${request.requestId}`}
        empty={<EmptyState title={empty ?? ''} />}
        columns={[
          { key: 'number', label: m.doc_number(), render: (request) => request.number },
          { key: 'kind', label: m.request_kind(), render: (request) => kindLabel(request.kind) },
          { key: 'title', label: m.request_title_label(), render: (request) => request.title },
          ...(showRequester
            ? [
                {
                  key: 'requester',
                  label: m.request_requester(),
                  render: (request: PurchaseRequest) => request.requester.name,
                },
              ]
            : []),
          {
            key: 'project',
            label: m.invoice_project_label(),
            render: (request) =>
              request.projectName ? `${request.projectName} · ${request.post}` : m.project_running(),
          },
          {
            key: 'amount',
            label: m.request_amount(),
            align: 'end' as const,
            render: (request) => shown(request.amount, request.currency),
          },
          {
            key: 'beyond',
            label: m.request_beyond(),
            align: 'end' as const,
            render: (request) =>
              request.standing && request.standing.beyondBy > 0
                ? shown(request.standing.beyondBy, request.currency)
                : '—',
          },
          {
            key: 'status',
            label: m.doc_status(),
            render: (request) => <RequestStatus status={request.status} />,
          },
        ]}
      />
    </section>
  );
}

function PurchasesHome() {
  const home = Route.useLoaderData();
  const navigate = useNavigate();
  const { standing, currency } = home;
  return (
    <PurchasesFrame
      current="home"
      title={m.purchases_title()}
      description={m.purchases_intro()}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: '/achats/note-de-frais' })}
          >
            {m.expense_new()}
          </Button>
          <Button onClick={() => void navigate({ to: '/achats/demande' })}>
            {m.purchase_new()}
          </Button>
        </>
      }
    >
      <KpiGrid label={m.purchases_title()}>
        <KpiTile
          label={m.kpi_waiting()}
          value={shown(standing.waiting, currency)}
          hint={m.kpi_waiting_hint()}
        />
        <KpiTile
          label={m.kpi_to_order()}
          value={shown(standing.toOrder, currency)}
          hint={m.kpi_to_order_hint()}
        />
        <KpiTile
          label={m.kpi_to_pay()}
          value={shown(standing.toPay, currency)}
          hint={m.kpi_to_pay_hint()}
        />
        <KpiTile
          label={m.kpi_advances()}
          value={shown(standing.advances, currency)}
          hint={m.kpi_advances_hint()}
          href="/achats/avances"
        />
      </KpiGrid>
      <Requests title={m.to_decide_title()} rows={home.toDecide} />
      <Requests title={m.to_order_title()} rows={home.toOrder} />
      <Requests title={m.to_pay_title()} rows={home.toPay} />
      <Requests
        title={home.may.readAll ? m.requests_all_title() : m.requests_mine_title()}
        rows={home.requests}
        empty={m.requests_empty()}
        showRequester={home.may.readAll}
      />
    </PurchasesFrame>
  );
}
