import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNote,
  Facts,
  Panel,
  SelectField,
  TextField,
} from '@kete/design';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { addReceipt, fetchInvoice, moveInvoice } from '@/features/sales/functions';
import { receiptMethods, type ReceiptMethod } from '@/features/sales/methods';
import { InvoiceStatus, SalesFrame } from '@/features/sales/ui/SalesFrame';
import { sayError } from '@/lib/errors';
import { shown, typed } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ventes/factures/$invoiceId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchInvoice({ data: { invoiceId: params.invoiceId } }),
  component: InvoicePage,
});

const methodLabel = (method: ReceiptMethod) =>
  ({
    cash: m.method_cash,
    bank: m.method_bank,
    mobile: m.method_mobile,
    cheque: m.method_cheque,
  })[method]();

function InvoicePage() {
  const { invoice, may } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [reference, setReference] = useState('');

  if (!invoice) {
    return (
      <SalesFrame current="invoices" title={m.invoices_title()}>
        <EmptyState title={m.invoice_not_found()} />
      </SalesFrame>
    );
  }

  const due = invoice.total - invoice.received;
  const received = typed(amount, invoice.currency);
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

  return (
    <SalesFrame
      current="invoices"
      title={`${invoice.number ?? m.invoice_no_number()} — ${invoice.title}`}
      status={<InvoiceStatus invoice={invoice} />}
      description={invoice.partyName}
      breadcrumbs={[
        { label: m.invoices_title(), href: '/ventes/factures' },
        { label: invoice.number ?? m.invoice_no_number() },
      ]}
      actions={
        invoice.status === 'draft' && (
          <>
            {may.write && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => moveInvoice({ data: { invoiceId: invoice.invoiceId, to: 'discard' } }),
                    () => void navigate({ to: '/ventes/factures' }),
                  )
                }
              >
                {m.invoice_discard()}
              </Button>
            )}
            {may.issue && (
              <Button disabled={busy} onClick={() => setConfirming(true)}>
                {m.invoice_issue()}
              </Button>
            )}
          </>
        )
      }
    >
      <ErrorNote>{error}</ErrorNote>
      <ConfirmDialog
        open={confirming}
        title={m.invoice_issue_confirm_title()}
        confirmLabel={m.invoice_issue()}
        cancelLabel={m.review_cancel()}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          run(() => moveInvoice({ data: { invoiceId: invoice.invoiceId, to: 'issue' } }));
        }}
      >
        {m.invoice_issue_confirm_body()}
      </ConfirmDialog>

      <DataTable
        caption={m.lines_title()}
        rows={invoice.lines.map((line, index) => ({ ...line, index }))}
        rowKey={(line) => String(line.index)}
        columns={[
          { key: 'label', label: m.line_label(), render: (line) => line.label },
          { key: 'quantity', label: m.line_quantity(), align: 'end', render: (line) => line.quantity },
          {
            key: 'unitPrice',
            label: m.line_unit_price(),
            align: 'end',
            render: (line) => shown(line.unitPrice, invoice.currency),
          },
        ]}
      />

      <Panel title={m.totals_title()}>
        <Facts
          items={[
            { label: m.total_subtotal(), value: shown(invoice.subtotal, invoice.currency) },
            {
              label: m.total_tax_rate({ rate: String(invoice.taxRate) }),
              value: shown(invoice.tax, invoice.currency),
            },
            { label: m.doc_total(), value: shown(invoice.total, invoice.currency) },
            { label: m.invoice_received(), value: shown(invoice.received, invoice.currency) },
            { label: m.invoice_due(), value: shown(due, invoice.currency) },
            ...(invoice.issuedOn ? [{ label: m.invoice_issued_on(), value: invoice.issuedOn }] : []),
            ...(invoice.dueOn ? [{ label: m.invoice_due_on(), value: invoice.dueOn }] : []),
          ]}
        />
      </Panel>

      {invoice.status === 'issued' && (
        <Panel title={m.receipts_title()}>
          <div className="flex flex-col gap-4">
            <DataTable
              caption={m.receipts_title()}
              rows={invoice.receipts}
              rowKey={(receipt) => receipt.receiptId}
              empty={<p className="text-fg-muted">{m.receipts_empty()}</p>}
              columns={[
                { key: 'receivedOn', label: m.doc_date(), render: (receipt) => receipt.receivedOn },
                { key: 'method', label: m.receipt_method(), render: (r) => methodLabel(r.method) },
                { key: 'reference', label: m.receipt_reference(), render: (r) => r.reference ?? '—' },
                {
                  key: 'amount',
                  label: m.receipt_amount(),
                  align: 'end',
                  render: (receipt) => shown(receipt.amount, invoice.currency),
                },
              ]}
            />
            {may.collect && due > 0 && (
              <form
                className="grid items-end gap-3 sm:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (received === null || received === 0) return;
                  run(
                    () =>
                      addReceipt({
                        data: {
                          invoiceId: invoice.invoiceId,
                          amount: received,
                          receivedOn,
                          method,
                          ...(reference.trim() ? { reference: reference.trim() } : {}),
                        },
                      }),
                    () => {
                      setAmount('');
                      setReference('');
                    },
                  );
                }}
              >
                <TextField
                  label={m.receipt_amount()}
                  hint={m.receipt_amount_hint({ due: shown(due, invoice.currency) })}
                  value={amount}
                  inputMode="decimal"
                  required
                  onChange={(event) => setAmount(event.target.value)}
                />
                <TextField
                  label={m.doc_date()}
                  type="date"
                  value={receivedOn}
                  required
                  onChange={(event) => setReceivedOn(event.target.value)}
                />
                <SelectField
                  label={m.receipt_method()}
                  value={method}
                  options={receiptMethods.map((value) => ({ value, label: methodLabel(value) }))}
                  onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
                />
                <TextField
                  label={m.receipt_reference()}
                  hint={m.receipt_reference_hint()}
                  value={reference}
                  maxLength={120}
                  onChange={(event) => setReference(event.target.value)}
                />
                <Button type="submit" disabled={busy || received === null || received === 0}>
                  {m.receipt_record()}
                </Button>
              </form>
            )}
          </div>
        </Panel>
      )}
    </SalesFrame>
  );
}
