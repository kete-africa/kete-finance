import { Button, DataTable, EmptyState, InfoNote, KpiGrid, KpiTile } from '@kete/design';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchSalesHome, tellCenterNow } from '@/features/sales/functions';
import { InvoiceStatus, SalesFrame } from '@/features/sales/ui/SalesFrame';
import { shown } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchSalesHome(),
  component: SalesHome,
});

function SalesHome() {
  const home = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { standing, currency } = home;
  return (
    <SalesFrame
      current="home"
      title={m.sales_title()}
      description={m.sales_intro()}
      actions={
        home.may.write && (
          <Button onClick={() => void navigate({ to: '/ventes/devis/nouveau' })}>
            {m.quote_new()}
          </Button>
        )
      }
    >
      {home.waiting > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <InfoNote>
            {home.connected
              ? m.center_waiting({ count: String(home.waiting) })
              : m.center_alone({ count: String(home.waiting) })}
          </InfoNote>
          {home.connected && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void tellCenterNow()
                  .then(() => router.invalidate())
                  .finally(() => setBusy(false));
              }}
            >
              {m.center_tell()}
            </Button>
          )}
        </div>
      )}
      <KpiGrid label={m.sales_title()}>
        <KpiTile
          label={m.kpi_open_quotes()}
          value={shown(standing.openQuotes.total, currency)}
          hint={m.kpi_open_quotes_hint({ count: String(standing.openQuotes.count) })}
          href="/ventes/devis"
        />
        <KpiTile
          label={m.kpi_to_invoice()}
          value={shown(standing.toInvoice, currency)}
          hint={m.kpi_to_invoice_hint()}
        />
        <KpiTile
          label={m.kpi_due()}
          value={shown(standing.due, currency)}
          hint={m.kpi_due_hint({ overdue: shown(standing.overdue, currency) })}
          href="/ventes/factures"
        />
        <KpiTile
          label={m.kpi_received()}
          value={shown(standing.receivedThisMonth, currency)}
          hint={m.kpi_received_hint()}
        />
      </KpiGrid>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-title font-semibold">{m.to_invoice_title()}</h2>
        <DataTable
          caption={m.to_invoice_title()}
          rows={home.toInvoice}
          rowKey={(quote) => quote.quoteId}
          rowHref={(quote) => `/ventes/devis/${quote.quoteId}`}
          empty={<EmptyState title={m.to_invoice_empty()} />}
          columns={[
            { key: 'number', label: m.doc_number(), render: (quote) => quote.number },
            { key: 'party', label: m.quote_party_label(), render: (quote) => quote.partyName },
            { key: 'title', label: m.quote_title_label(), render: (quote) => quote.title },
            {
              key: 'left',
              label: m.to_invoice_left(),
              align: 'end',
              render: (quote) => shown(quote.total - quote.invoiced, quote.currency),
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-title font-semibold">{m.due_title()}</h2>
        <DataTable
          caption={m.due_title()}
          rows={home.due}
          rowKey={(invoice) => invoice.invoiceId}
          rowHref={(invoice) => `/ventes/factures/${invoice.invoiceId}`}
          empty={<EmptyState title={m.due_empty()} />}
          columns={[
            { key: 'number', label: m.doc_number(), render: (invoice) => invoice.number ?? '' },
            { key: 'party', label: m.quote_party_label(), render: (invoice) => invoice.partyName },
            { key: 'dueOn', label: m.invoice_due_on(), render: (invoice) => invoice.dueOn ?? '—' },
            {
              key: 'due',
              label: m.invoice_due(),
              align: 'end',
              render: (invoice) => shown(invoice.total - invoice.received, invoice.currency),
            },
            {
              key: 'status',
              label: m.doc_status(),
              render: (invoice) => <InvoiceStatus invoice={invoice} />,
            },
          ]}
        />
      </section>
    </SalesFrame>
  );
}
