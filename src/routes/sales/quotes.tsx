import { Button, DataTable, EmptyState } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchQuotes } from '@/features/sales/functions';
import { QuoteStatus, SalesFrame } from '@/features/sales/ui/SalesFrame';
import { shown } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/devis')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchQuotes(),
  component: QuotesPage,
});

function QuotesPage() {
  const { quotes, may } = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <SalesFrame
      current="quotes"
      title={m.quotes_title()}
      actions={
        may.write && (
          <Button onClick={() => void navigate({ to: '/ventes/devis/nouveau' })}>
            {m.quote_new()}
          </Button>
        )
      }
    >
      <DataTable
        caption={m.quotes_title()}
        rows={quotes}
        rowKey={(quote) => quote.quoteId}
        rowHref={(quote) => `/ventes/devis/${quote.quoteId}`}
        empty={<EmptyState title={m.quotes_empty()}>{m.quotes_empty_body()}</EmptyState>}
        columns={[
          { key: 'number', label: m.doc_number(), render: (quote) => quote.number },
          { key: 'party', label: m.quote_party_label(), render: (quote) => quote.partyName },
          { key: 'title', label: m.quote_title_label(), render: (quote) => quote.title },
          { key: 'date', label: m.doc_date(), render: (quote) => quote.createdOn },
          {
            key: 'total',
            label: m.doc_total(),
            align: 'end',
            render: (quote) => shown(quote.total, quote.currency),
          },
          {
            key: 'status',
            label: m.doc_status(),
            render: (quote) => <QuoteStatus status={quote.status} />,
          },
        ]}
      />
    </SalesFrame>
  );
}
