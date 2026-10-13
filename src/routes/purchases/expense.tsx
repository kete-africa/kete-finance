import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { fetchRequestForm, fileExpense } from '@/features/purchases/functions';
import { PurchasesFrame } from '@/features/purchases/ui/PurchasesFrame';
import { RequestForm } from '@/features/purchases/ui/RequestForm';
import { sayError } from '@/lib/errors';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/achats/note-de-frais')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRequestForm(),
  component: ExpensePage,
});

function ExpensePage() {
  const form = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <PurchasesFrame
      current="home"
      title={m.expense_new()}
      description={m.expense_new_intro()}
      breadcrumbs={[{ label: m.purchases_title(), href: '/achats' }, { label: m.expense_new() }]}
    >
      <RequestForm
        kind="expense"
        currency={form.currency}
        connected={form.connected}
        projects={form.projects}
        advances={form.advances}
        submitLabel={m.expense_file()}
        onSubmit={async ({ partyId: _a, partyName: _b, spentOn, ...request }) => {
          const outcome = await fileExpense({
            data: { ...request, spentOn: spentOn ?? new Date().toISOString().slice(0, 10) },
          });
          if (!outcome.ok) return sayError(outcome.code, outcome.facts);
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
