import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { askPurchase, fetchRequestForm } from '@/features/purchases/functions';
import { PurchasesFrame } from '@/features/purchases/ui/PurchasesFrame';
import { RequestForm } from '@/features/purchases/ui/RequestForm';
import { sayError } from '@/lib/errors';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/achats/demande')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRequestForm(),
  component: AskPage,
});

function AskPage() {
  const form = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <PurchasesFrame
      current="home"
      title={m.purchase_new()}
      description={m.purchase_new_intro()}
      breadcrumbs={[{ label: m.purchases_title(), href: '/achats' }, { label: m.purchase_new() }]}
    >
      <RequestForm
        kind="purchase"
        currency={form.currency}
        connected={form.connected}
        projects={form.projects}
        submitLabel={m.request_ask()}
        onSubmit={async ({ spentOn: _a, proof: _b, advanceId: _c, ...request }) => {
          const outcome = await askPurchase({ data: request });
          if (!outcome.ok) return sayError(outcome.code);
          await navigate({
            to: '/achats/$requestId',
            params: { requestId: outcome.output.requestId },
          });
          return null;
        }}
      />
    </PurchasesFrame>
  );
}
