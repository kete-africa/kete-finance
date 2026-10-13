import { Button, DataTable, EmptyState } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchInvoices } from '@/features/sales/functions';
import { InvoiceStatus, SalesFrame } from '@/features/sales/ui/SalesFrame';
import { shown } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/factures')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchInvoices(),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { invoices, may } = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <SalesFrame
      current="invoices"
      title={m.invoices_title()}
      actions={
        may.write && (
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: '/ventes/factures/nouvelle' })}
          >
            {m.invoice_new()}
          </Button>
        )
      }
    >
      <DataTable
        caption={m.invoices_title()}
        rows={invoices}
        rowKey={(invoice) => invoice.invoiceId}
        rowHref={(invoice) => `/ventes/factures/${invoice.invoiceId}`}
        empty={<EmptyState title={m.invoices_empty()}>{m.invoices_empty_body()}</EmptyState>}
        columns={[
          {
            key: 'number',
            label: m.doc_number(),
            render: (invoice) => invoice.number ?? m.invoice_no_number(),
          },
          { key: 'party', label: m.quote_party_label(), render: (invoice) => invoice.partyName },
          { key: 'title', label: m.quote_title_label(), render: (invoice) => invoice.title },
          { key: 'date', label: m.doc_date(), render: (invoice) => invoice.issuedOn ?? '—' },
          {
            key: 'total',
            label: m.doc_total(),
            align: 'end',
            render: (invoice) => shown(invoice.total, invoice.currency),
          },
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
    </SalesFrame>
  );
}
