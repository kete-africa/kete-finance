import { PageHeader, Tabs, Tag, type Crumb, type TagTone } from '@kete/design';
import type { ReactNode } from 'react';
import { AppShell } from '@/lib/shell';
import * as m from '@/paraglide/messages.js';
import type { PurchaseRequest } from '../purchase.record';

/** The frame of every screen of purchases and expenses. */
export function PurchasesFrame({
  current,
  title,
  status,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  current: 'home' | 'advances';
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
        label={m.purchases_title()}
        current={current}
        items={[
          { key: 'home', label: m.purchases_requests(), href: '/achats' },
          { key: 'advances', label: m.advances_title(), href: '/achats/avances' },
        ]}
      />
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </AppShell>
  );
}

const tones: Record<PurchaseRequest['status'], TagTone> = {
  asked: 'info',
  returned: 'verify',
  approved: 'validated',
  refused: 'error',
  ordered: 'validated',
  paid: 'neutral',
  cancelled: 'neutral',
};

export function RequestStatus({ status }: { status: PurchaseRequest['status'] }) {
  const label = {
    asked: m.request_asked,
    returned: m.request_returned,
    approved: m.request_approved,
    refused: m.request_refused,
    ordered: m.request_ordered,
    paid: m.request_paid,
    cancelled: m.request_cancelled,
  }[status]();
  return <Tag tone={tones[status]}>{label}</Tag>;
}

export const kindLabel = (kind: PurchaseRequest['kind']) =>
  kind === 'expense' ? m.kind_expense() : m.kind_purchase();
