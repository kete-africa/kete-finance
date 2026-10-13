import { PageHeader, Tabs, Tag, type Crumb, type TagTone } from '@kete/design';
import type { ReactNode } from 'react';
import { AppShell } from '@/lib/shell';
import * as m from '@/paraglide/messages.js';
import type { Invoice, Quote } from '../quote.record';

/** The frame of every screen of sales: its header, and its three places. */
export function SalesFrame({
  current,
  title,
  status,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  current: 'home' | 'quotes' | 'invoices';
  title: ReactNode;
  status?: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell>
      <PageHeader
        breadcrumbLabel={m.breadcrumb_label()}
        {...(breadcrumbs ? { breadcrumbs } : {})}
        title={title}
        status={status}
        description={description}
        actions={actions}
      />
      <Tabs
        label={m.sales_title()}
        current={current}
        items={[
          { key: 'home', label: m.sales_home(), href: '/ventes' },
          { key: 'quotes', label: m.quotes_title(), href: '/ventes/devis' },
          { key: 'invoices', label: m.invoices_title(), href: '/ventes/factures' },
        ]}
      />
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </AppShell>
  );
}

const quoteTones: Record<Quote['status'], TagTone> = {
  draft: 'neutral',
  sent: 'info',
  won: 'validated',
  lost: 'error',
};

export function QuoteStatus({ status }: { status: Quote['status'] }) {
  const label = {
    draft: m.status_draft,
    sent: m.status_sent,
    won: m.status_won,
    lost: m.status_lost,
  }[status]();
  return <Tag tone={quoteTones[status]}>{label}</Tag>;
}

/** An invoice's state as a person reads it: a draft, due, or paid. */
export function InvoiceStatus({ invoice }: { invoice: Pick<Invoice, 'status' | 'total' | 'received'> }) {
  if (invoice.status === 'draft') return <Tag tone="neutral">{m.status_draft()}</Tag>;
  if (invoice.received >= invoice.total) return <Tag tone="validated">{m.status_paid()}</Tag>;
  return (
    <Tag tone="verify">{invoice.received > 0 ? m.status_partly_paid() : m.status_due()}</Tag>
  );
}
