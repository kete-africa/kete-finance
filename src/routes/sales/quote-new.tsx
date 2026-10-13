import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchSalesSetting, saveQuote } from '@/features/sales/functions';
import { DocumentForm } from '@/features/sales/ui/DocumentForm';
import { SalesFrame } from '@/features/sales/ui/SalesFrame';
import { sayError } from '@/lib/errors';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/devis/nouveau')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchSalesSetting(),
  component: NewQuotePage,
});

function NewQuotePage() {
  const setting = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <SalesFrame
      current="quotes"
      title={m.quote_new()}
      description={m.quote_new_intro()}
      breadcrumbs={[{ label: m.quotes_title(), href: '/ventes/devis' }, { label: m.quote_new() }]}
    >
      <DocumentForm
        kind="quote"
        currency={setting.currency}
        connected={setting.connected}
        submitLabel={m.quote_save()}
        onSubmit={async (quote) => {
          const outcome = await saveQuote({ data: quote });
          if (!outcome.ok) return sayError(outcome.code);
          await navigate({ to: '/ventes/devis/$quoteId', params: { quoteId: outcome.output.quoteId } });
          return null;
        }}
      />
    </SalesFrame>
  );
}
