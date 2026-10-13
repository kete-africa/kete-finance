import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNote,
  Facts,
  InfoNote,
  Panel,
  TextField,
} from '@kete/design';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  fetchQuote,
  fetchSalesSetting,
  invoiceShare,
  moveQuote,
  saveQuote,
  tellCenterNow,
} from '@/features/sales/functions';
import { DocumentForm } from '@/features/sales/ui/DocumentForm';
import { InvoiceStatus, QuoteStatus, SalesFrame } from '@/features/sales/ui/SalesFrame';
import { sayError } from '@/lib/errors';
import { shown } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/devis/$quoteId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => ({
    ...(await fetchQuote({ data: { quoteId: params.quoteId } })),
    setting: await fetchSalesSetting(),
  }),
  component: QuotePage,
});

function QuotePage() {
  const { quote, invoices, connected, may, setting } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<'win' | 'lose' | null>(null);
  const [share, setShare] = useState('30');

  if (!quote) {
    return (
      <SalesFrame current="quotes" title={m.quotes_title()}>
        <EmptyState title={m.quote_not_found()} />
      </SalesFrame>
    );
  }

  const run = (work: () => Promise<{ ok: true } | { ok: false; code: string }>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (outcome) => {
        if (!outcome.ok) setError(sayError(outcome.code));
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  const move = (to: 'send' | 'win' | 'lose') =>
    run(() => moveQuote({ data: { quoteId: quote.quoteId, to } }));

  const open = quote.status === 'draft' || quote.status === 'sent';
  const left = quote.total - quote.invoiced;
  const shareValue = Number(share.replace(',', '.'));
  const shareOk = Number.isFinite(shareValue) && shareValue > 0 && shareValue <= 100;

  return (
    <SalesFrame
      current="quotes"
      title={`${quote.number} — ${quote.title}`}
      status={<QuoteStatus status={quote.status} />}
      description={quote.partyName}
      breadcrumbs={[{ label: m.quotes_title(), href: '/ventes/devis' }, { label: quote.number }]}
      actions={
        may.write &&
        open && (
          <>
            {quote.status === 'draft' && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => setEditing(!editing)}>
                  {editing ? m.quote_edit_close() : m.quote_edit()}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => move('send')}>
                  {m.quote_send()}
                </Button>
              </>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming('lose')}>
              {m.quote_lose()}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming('win')}>
              {m.quote_win()}
            </Button>
          </>
        )
      }
    >
      <ErrorNote>{error}</ErrorNote>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'win' ? m.quote_win_confirm_title() : m.quote_lose_confirm_title()}
        confirmLabel={confirming === 'win' ? m.quote_win() : m.quote_lose()}
        cancelLabel={m.review_cancel()}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const to = confirming;
          setConfirming(null);
          if (to) move(to);
        }}
      >
        {confirming === 'win' ? m.quote_win_confirm_body() : m.quote_lose_confirm_body()}
      </ConfirmDialog>

      {editing && quote.status === 'draft' ? (
        <DocumentForm
          kind="quote"
          currency={quote.currency}
          connected={setting.connected}
          start={quote}
          submitLabel={m.quote_save()}
          onSubmit={async (written) => {
            const outcome = await saveQuote({ data: { ...written, quoteId: quote.quoteId } });
            if (!outcome.ok) return sayError(outcome.code);
            setEditing(false);
            await router.invalidate();
            return null;
          }}
        />
      ) : (
        <>
          {quote.status === 'won' &&
            (quote.projectId ? (
              <InfoNote>{m.quote_project_open({ name: quote.projectName ?? quote.title })}</InfoNote>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <InfoNote>
                  {connected ? m.quote_project_waiting() : m.quote_project_alone()}
                </InfoNote>
                {connected && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(async () => ((await tellCenterNow()), { ok: true }))}
                  >
                    {m.quote_project_retry()}
                  </Button>
                )}
              </div>
            ))}

          <DataTable
            caption={m.lines_title()}
            rows={quote.lines.map((line, index) => ({ ...line, index }))}
            rowKey={(line) => String(line.index)}
            columns={[
              { key: 'label', label: m.line_label(), render: (line) => line.label },
              { key: 'quantity', label: m.line_quantity(), align: 'end', render: (line) => line.quantity },
              {
                key: 'unitPrice',
                label: m.line_unit_price(),
                align: 'end',
                render: (line) => shown(line.unitPrice, quote.currency),
              },
              {
                key: 'unitCost',
                label: m.line_unit_cost(),
                align: 'end',
                render: (line) => shown(line.unitCost, quote.currency),
              },
              { key: 'post', label: m.line_post(), render: (line) => line.post },
            ]}
          />

          <Panel title={m.totals_title()}>
            <Facts
              items={[
                { label: m.total_subtotal(), value: shown(quote.subtotal, quote.currency) },
                {
                  label: m.total_tax_rate({ rate: String(quote.taxRate) }),
                  value: shown(quote.tax, quote.currency),
                },
                { label: m.doc_total(), value: shown(quote.total, quote.currency) },
                { label: m.total_cost(), value: shown(quote.cost, quote.currency) },
                {
                  label: m.total_margin(),
                  value: shown(quote.subtotal - quote.cost, quote.currency),
                },
                ...(quote.validUntil
                  ? [{ label: m.quote_valid_label(), value: quote.validUntil }]
                  : []),
              ]}
            />
          </Panel>

          {quote.status === 'won' && (
            <Panel title={m.quote_invoices_title()}>
              <div className="flex flex-col gap-4">
                <p className="text-fg-muted">
                  {left > 0
                    ? m.quote_left_to_invoice({ amount: shown(left, quote.currency) })
                    : m.quote_wholly_invoiced()}
                </p>
                {invoices.length > 0 && (
                  <DataTable
                    caption={m.quote_invoices_title()}
                    rows={invoices}
                    rowKey={(invoice) => invoice.invoiceId}
                    rowHref={(invoice) => `/ventes/factures/${invoice.invoiceId}`}
                    columns={[
                      {
                        key: 'number',
                        label: m.doc_number(),
                        render: (invoice) => invoice.number ?? m.invoice_no_number(),
                      },
                      {
                        key: 'total',
                        label: m.doc_total(),
                        align: 'end',
                        render: (invoice) => shown(invoice.total, invoice.currency),
                      },
                      {
                        key: 'status',
                        label: m.doc_status(),
                        render: (invoice) => <InvoiceStatus invoice={invoice} />,
                      },
                    ]}
                  />
                )}
                {may.write && left > 0 && (
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!shareOk) return;
                      setBusy(true);
                      setError(null);
                      void invoiceShare({ data: { quoteId: quote.quoteId, share: shareValue } })
                        .then(async (outcome) => {
                          if (!outcome.ok) return setError(sayError(outcome.code));
                          await navigate({
                            to: '/ventes/factures/$invoiceId',
                            params: { invoiceId: outcome.output.invoiceId },
                          });
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    <TextField
                      label={m.quote_share_label()}
                      hint={m.quote_share_hint()}
                      value={share}
                      inputMode="decimal"
                      onChange={(event) => setShare(event.target.value)}
                    />
                    <Button type="submit" disabled={busy || !shareOk}>
                      {m.quote_invoice()}
                    </Button>
                  </form>
                )}
              </div>
            </Panel>
          )}
        </>
      )}
    </SalesFrame>
  );
}
