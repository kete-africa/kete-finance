import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { addInvoice, fetchMyProjects, fetchSalesSetting } from '@/features/sales/functions';
import { DocumentForm } from '@/features/sales/ui/DocumentForm';
import { SalesFrame } from '@/features/sales/ui/SalesFrame';
import { sayError } from '@/lib/errors';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/factures/nouvelle')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => ({ setting: await fetchSalesSetting(), projects: await fetchMyProjects() }),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const { setting, projects } = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <SalesFrame
      current="invoices"
      title={m.invoice_new()}
      description={m.invoice_new_intro()}
      breadcrumbs={[
        { label: m.invoices_title(), href: '/ventes/factures' },
        { label: m.invoice_new() },
      ]}
    >
      <DocumentForm
        kind="invoice"
        currency={setting.currency}
        connected={setting.connected}
        projects={projects}
        submitLabel={m.invoice_prepare()}
        onSubmit={async ({ lines, validUntil: _none, ...invoice }) => {
          const outcome = await addInvoice({
            data: {
              ...invoice,
              lines: lines.map(({ label, quantity, unitPrice }) => ({ label, quantity, unitPrice })),
            },
          });
          if (!outcome.ok) return sayError(outcome.code);
          await navigate({
            to: '/ventes/factures/$invoiceId',
            params: { invoiceId: outcome.output.invoiceId },
          });
          return null;
        }}
      />
    </SalesFrame>
  );
}
