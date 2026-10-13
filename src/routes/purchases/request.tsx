import {
  Button,
  DataTable,
  EmptyState,
  ErrorNote,
  Facts,
  InfoNote,
  Panel,
  SelectField,
  TextAreaField,
  TextField,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  correctRequest,
  decideRequest,
  fetchRequest,
  fetchRequestForm,
  orderPurchase,
  payRequest,
} from '@/features/purchases/functions';
import {
  kindLabel,
  PurchasesFrame,
  RequestStatus,
} from '@/features/purchases/ui/PurchasesFrame';
import { RequestForm } from '@/features/purchases/ui/RequestForm';
import { receiptMethods, type ReceiptMethod } from '@/features/sales/methods';
import { sayError } from '@/lib/errors';
import { shown, typed } from '@/lib/money';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/achats/$requestId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => ({
    ...(await fetchRequest({ data: { requestId: params.requestId } })),
    form: await fetchRequestForm(),
  }),
  component: RequestPage,
});

const methodLabel = (method: ReceiptMethod) =>
  ({
    cash: m.method_cash,
    bank: m.method_bank,
    mobile: m.method_mobile,
    cheque: m.method_cheque,
  })[method]();

function RequestPage() {
  const { request, mine, may, form } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [supplier, setSupplier] = useState(request?.partyName ?? '');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [reference, setReference] = useState('');

  if (!request) {
    return (
      <PurchasesFrame current="home" title={m.purchases_title()}>
        <EmptyState title={m.request_not_found()} />
      </PurchasesFrame>
    );
  }

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

  const owed = request.amount - request.paid;
  const paying = typed(amount, request.currency);
  const decidesHere =
    request.status === 'asked' && request.route === 'here' && may.approve && !mine;
  const payable =
    (request.status === 'approved' || request.status === 'ordered') && may.pay && !mine && owed > 0;

  return (
    <PurchasesFrame
      current="home"
      title={`${request.number} — ${request.title}`}
      status={<RequestStatus status={request.status} />}
      description={`${kindLabel(request.kind)} · ${request.requester.name}`}
      breadcrumbs={[{ label: m.purchases_title(), href: '/achats' }, { label: request.number }]}
    >
      <ErrorNote>{error}</ErrorNote>

      {request.standing && request.standing.beyondBy > 0 && (
        <InfoNote>
          {m.request_beyond_note({
            by: shown(request.standing.beyondBy, request.currency),
            post: request.post ?? '',
            left: shown(Math.max(request.standing.left, 0), request.currency),
          })}
        </InfoNote>
      )}
      {request.agreement === 'unchecked' && <InfoNote>{m.request_agreement_unchecked()}</InfoNote>}
      {request.status === 'asked' && (
        <InfoNote>
          {request.route === 'center'
            ? m.request_waits_center()
            : request.route === 'here'
              ? m.request_waits_here()
              : m.request_waits_route()}
        </InfoNote>
      )}
      {request.decided && request.status !== 'asked' && (
        <InfoNote>
          {request.decided.reason
            ? m.request_decided_reason({ by: request.decided.by, reason: request.decided.reason })
            : m.request_decided({ by: request.decided.by })}
        </InfoNote>
      )}

      {request.status === 'returned' && mine ? (
        <RequestForm
          kind={request.kind}
          currency={request.currency}
          connected={form.connected}
          projects={form.projects}
          start={request}
          submitLabel={m.request_resend()}
          onSubmit={async ({ spentOn: _a, proof: _b, advanceId: _c, ...written }) => {
            const outcome = await correctRequest({
              data: { ...written, requestId: request.requestId },
            });
            if (!outcome.ok) return sayError(outcome.code, outcome.facts);
            await router.invalidate();
            return null;
          }}
        />
      ) : (
        <>
          <DataTable
            caption={m.lines_title()}
            rows={request.lines.map((line, index) => ({ ...line, index }))}
            rowKey={(line) => String(line.index)}
            columns={[
              { key: 'label', label: m.line_label(), render: (line) => line.label },
              { key: 'quantity', label: m.line_quantity(), align: 'end', render: (line) => line.quantity },
              {
                key: 'unitPrice',
                label: m.line_unit_price(),
                align: 'end',
                render: (line) => shown(line.unitPrice, request.currency),
              },
            ]}
          />
          <Panel>
            <Facts
              items={[
                { label: m.request_amount(), value: shown(request.amount, request.currency) },
                { label: m.request_paid_amount(), value: shown(request.paid, request.currency) },
                {
                  label: m.invoice_project_label(),
                  value: request.projectName ?? m.project_running(),
                },
                ...(request.post ? [{ label: m.line_post(), value: request.post }] : []),
                ...(request.standing
                  ? [
                      {
                        label: m.request_post_budget(),
                        value: shown(request.standing.budget, request.currency),
                      },
                      {
                        label: m.request_post_left(),
                        value: shown(request.standing.left, request.currency),
                      },
                    ]
                  : []),
                ...(request.partyName
                  ? [{ label: m.request_supplier_label(), value: request.partyName }]
                  : []),
                ...(request.orderNumber
                  ? [{ label: m.request_order_number(), value: request.orderNumber }]
                  : []),
                ...(request.spentOn ? [{ label: m.expense_spent_on(), value: request.spentOn }] : []),
                ...(request.proof ? [{ label: m.expense_proof(), value: request.proof }] : []),
                { label: m.request_asked_on(), value: request.askedOn },
              ]}
            />
          </Panel>
        </>
      )}

      {decidesHere && (
        <Panel title={m.request_decide_title()}>
          <div className="flex flex-col gap-3">
            <TextAreaField
              label={m.request_reason()}
              hint={m.request_reason_hint()}
              value={reason}
              rows={2}
              maxLength={1000}
              onChange={setReason}
            />
            <div className="flex flex-wrap gap-2">
              {(['approve', 'return', 'refuse'] as const).map((decision) => (
                <Button
                  key={decision}
                  variant={decision === 'approve' ? 'primary' : 'secondary'}
                  disabled={busy || (decision === 'return' && reason.trim() === '')}
                  onClick={() =>
                    run(() =>
                      decideRequest({
                        data: {
                          requestId: request.requestId,
                          decision,
                          ...(reason.trim() ? { reason: reason.trim() } : {}),
                        },
                      }),
                    )
                  }
                >
                  {{ approve: m.decide_approve, return: m.decide_return, refuse: m.decide_refuse }[decision]()}
                </Button>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {request.kind === 'purchase' && request.status === 'approved' && may.order && (
        <Panel title={m.request_order_title()}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              run(() =>
                orderPurchase({
                  data: {
                    requestId: request.requestId,
                    ...(supplier.trim() ? { partyName: supplier.trim() } : {}),
                  },
                }),
              );
            }}
          >
            <TextField
              label={m.request_supplier_label()}
              value={supplier}
              required
              maxLength={200}
              onChange={(event) => setSupplier(event.target.value)}
            />
            <Button type="submit" disabled={busy || supplier.trim() === ''}>
              {m.request_order()}
            </Button>
          </form>
        </Panel>
      )}

      {(request.payments.length > 0 || payable) && (
        <Panel title={m.payments_title()}>
          <div className="flex flex-col gap-4">
            <DataTable
              caption={m.payments_title()}
              rows={request.payments}
              rowKey={(payment) => payment.paymentId}
              empty={<p className="text-fg-muted">{m.payments_empty()}</p>}
              columns={[
                { key: 'paidOn', label: m.doc_date(), render: (payment) => payment.paidOn },
                { key: 'method', label: m.receipt_method(), render: (p) => methodLabel(p.method) },
                { key: 'reference', label: m.receipt_reference(), render: (p) => p.reference ?? '—' },
                {
                  key: 'amount',
                  label: m.receipt_amount(),
                  align: 'end',
                  render: (payment) => shown(payment.amount, request.currency),
                },
              ]}
            />
            {payable && (
              <form
                className="grid items-end gap-3 sm:grid-cols-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (paying === null || paying === 0) return;
                  run(
                    () =>
                      payRequest({
                        data: {
                          requestId: request.requestId,
                          amount: paying,
                          paidOn,
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
                  hint={m.payment_amount_hint({ owed: shown(owed, request.currency) })}
                  value={amount}
                  inputMode="decimal"
                  required
                  onChange={(event) => setAmount(event.target.value)}
                />
                <TextField
                  label={m.doc_date()}
                  type="date"
                  value={paidOn}
                  required
                  onChange={(event) => setPaidOn(event.target.value)}
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
                <Button type="submit" disabled={busy || paying === null || paying === 0}>
                  {m.payment_record()}
                </Button>
              </form>
            )}
          </div>
        </Panel>
      )}
    </PurchasesFrame>
  );
}
