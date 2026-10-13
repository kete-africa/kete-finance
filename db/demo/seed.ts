import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole } from '@kete/capabilities';
import { treasuryStanding } from '@/features/treasury';
import { transaction } from '@/platform/db';
import { registry } from '@/platform/registry';
import { asPerson } from '@/platform/rights';
import { screenActor } from '@/platform/session';
import { syncCenter } from '@/platform/sync';

// The demonstration's data: a small solar installer, « Soleil d'Afrique », a few days into its
// month. Everything is written through the app's own gestures, as its people would.

export const DEMO_ORGANIZATION = 'org_demo_finance';

const person = (userId: string, name: string, role: KeteIdentity['role']): KeteIdentity => ({
  userId,
  email: `${userId}@example.test`,
  name,
  organizationId: DEMO_ORGANIZATION,
  role,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 8 * 3_600_000),
});

/** Who the demonstration can be opened as: the owner, and one person per role of the trade. */
export const demoPeople = {
  owner: person('usr_demo_afi', 'Afi Mensah', 'owner'),
  sales: person('usr_demo_kossi', 'Kossi Adjo', 'member'),
  buyer: person('usr_demo_yao', 'Yao Agbeko', 'member'),
  accountant: person('usr_demo_lawson', 'Mme Lawson', 'member'),
  cashier: person('usr_demo_essi', 'Essi Dogbe', 'member'),
} as const;
export type DemoRole = keyof typeof demoPeople;

async function act<T = Record<string, unknown>>(
  who: KeteIdentity,
  name: string,
  input: unknown,
): Promise<T> {
  const result = await asPerson(who, () =>
    registry.invoke({
      actor: screenActor(who),
      organizationId: DEMO_ORGANIZATION,
      name,
      input,
      confirmed: true,
    }),
  );
  if (result.status !== 'done') throw new Error(`${name}: ${JSON.stringify(result)}`);
  // What follows a gesture on a screen: here, without a center, who decides her requests.
  await syncCenter(null, { actor: screenActor(who), organizationId: DEMO_ORGANIZATION });
  return result.output as T;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function seedDemo(): Promise<void> {
  const { owner, sales, buyer, accountant, cashier } = demoPeople;
  await transaction(DEMO_ORGANIZATION, async (db) => {
    for (const [role, who] of Object.entries(demoPeople)) {
      if (role !== 'owner') await assignBusinessRole(db, DEMO_ORGANIZATION, who.userId, role);
    }
  });

  // The accounts first: what is received and paid then lands on them.
  await act(owner, 'treasury_open_account', {
    name: 'Ecobank — compte courant',
    kind: 'bank',
    opening: 3_500_000,
    openedOn: day(-30),
  });
  const till = await act<{ accountId: string }>(accountant, 'treasury_open_account', {
    name: 'Caisse du bureau',
    kind: 'till',
    opening: 120_000,
    openedOn: day(-30),
  });
  await act(accountant, 'treasury_open_account', {
    name: 'TMoney',
    kind: 'mobile',
    opening: 45_000,
    openedOn: day(-30),
  });

  // Won, partly invoiced, partly paid.
  const clinic = await act<{ quoteId: string }>(sales, 'quotes_create', {
    title: 'Centrale solaire 12 kWc',
    partyName: 'Clinique Biasa',
    taxRate: 18,
    validUntil: day(20),
    lines: [
      { label: 'Panneau 450 W', quantity: 8, unitPrice: 245_000, unitCost: 180_000, post: 'Matériel' },
      { label: 'Onduleur hybride 10 kVA', quantity: 1, unitPrice: 1_450_000, unitCost: 1_100_000, post: 'Matériel' },
      { label: 'Pose et mise en service', quantity: 1, unitPrice: 400_000, unitCost: 250_000, post: 'Main-d’œuvre' },
      { label: 'Transport et levage', quantity: 1, unitPrice: 120_000, unitCost: 90_000, post: 'Transport' },
    ],
  });
  await act(sales, 'quotes_send', clinic);
  await act(sales, 'quotes_win', clinic);
  const deposit = await act<{ invoiceId: string }>(sales, 'invoices_from_quote', {
    ...clinic,
    share: 30,
    label: 'Acompte 30 %',
    dueOn: day(10),
  });
  await act(accountant, 'invoices_issue', deposit);
  await act(cashier, 'receipts_record', {
    ...deposit,
    amount: 800_000,
    receivedOn: day(-1),
    method: 'bank',
    reference: 'VIR ECOBANK 4471',
  });

  // Sent, waiting for the client's answer.
  const pharmacy = await act<{ quoteId: string }>(sales, 'quotes_create', {
    title: 'Kit solaire 3 kWc',
    partyName: 'Pharmacie du Port',
    taxRate: 18,
    validUntil: day(12),
    lines: [
      { label: 'Kit 3 kWc complet', quantity: 1, unitPrice: 1_850_000, unitCost: 1_400_000, post: 'Matériel' },
      { label: 'Pose', quantity: 1, unitPrice: 150_000, unitCost: 80_000, post: 'Main-d’œuvre' },
    ],
  });
  await act(sales, 'quotes_send', pharmacy);

  // A draft, still being written.
  await act(sales, 'quotes_create', {
    title: 'Contrat de maintenance annuelle',
    partyName: 'Hôtel Sarakawa',
    taxRate: 18,
    lines: [
      { label: 'Visite trimestrielle', quantity: 4, unitPrice: 85_000, unitCost: 40_000, post: 'Main-d’œuvre' },
    ],
  });

  // Won and not invoiced at all yet.
  const school = await act<{ quoteId: string }>(sales, 'quotes_create', {
    title: 'Éclairage solaire de la cour',
    partyName: 'École La Colombe',
    taxRate: 0,
    lines: [
      { label: 'Lampadaire solaire 60 W', quantity: 6, unitPrice: 95_000, unitCost: 62_000, post: 'Matériel' },
      { label: 'Pose', quantity: 6, unitPrice: 15_000, unitCost: 8_000, post: 'Main-d’œuvre' },
    ],
  });
  await act(owner, 'quotes_win', school);

  // A service without a quote, issued, late.
  const repair = await act<{ invoiceId: string }>(sales, 'invoices_create', {
    title: 'Dépannage onduleur',
    partyName: 'Imprimerie Nouvelle',
    taxRate: 18,
    dueOn: day(-6),
    lines: [
      { label: 'Diagnostic et remplacement de carte', quantity: 1, unitPrice: 135_000 },
      { label: 'Déplacement', quantity: 1, unitPrice: 15_000 },
    ],
  });
  await act(accountant, 'invoices_issue', repair);

  // Purchases and expenses. Without a center there is no project: everything is the running of
  // the organization, decided here by the owner.
  type Asked = { requestId: string };
  const ink = await act<Asked>(sales, 'purchases_ask', {
    title: 'Cartouches d’encre',
    partyName: 'Papeterie du Golfe',
    lines: [{ label: 'Cartouche noire XL', quantity: 2, unitPrice: 18_000 }],
  });
  await act(owner, 'purchases_decide', { ...ink, decision: 'approve' });
  await act(buyer, 'purchases_order', ink);
  await act(cashier, 'purchases_pay', {
    ...ink,
    amount: 36_000,
    paidOn: day(-2),
    method: 'cash',
    reference: 'Reçu n° 2217',
  });

  // Asked, waiting for the owner.
  await act(sales, 'purchases_ask', {
    title: 'Outillage de pose',
    partyName: 'Quincaillerie Moderne',
    lines: [
      { label: 'Perforateur', quantity: 1, unitPrice: 95_000 },
      { label: 'Jeu de clés dynamométriques', quantity: 1, unitPrice: 50_000 },
    ],
  });

  // An expense note, approved, to pay back.
  const fuel = await act<Asked>(buyer, 'expenses_file', {
    title: 'Carburant véhicule de service',
    spentOn: day(-3),
    proof: 'Ticket Total n° 88213',
    lines: [{ label: 'Gasoil', quantity: 1, unitPrice: 25_000 }],
  });
  await act(owner, 'purchases_decide', { ...fuel, decision: 'approve' });

  // Sent back: what is to be corrected is said.
  const internet = await act<Asked>(accountant, 'purchases_ask', {
    title: 'Abonnement internet',
    partyName: 'Togocom',
    lines: [{ label: 'Fibre 50 Mb/s', quantity: 1, unitPrice: 45_000 }],
  });
  await act(owner, 'purchases_decide', {
    ...internet,
    decision: 'return',
    reason: 'Précisez la période : un mois, ou l’année ?',
  });

  // An advance, partly justified by a note.
  const advance = await act<{ advanceId: string }>(cashier, 'advances_give', {
    holderId: sales.userId,
    holderName: sales.name,
    purpose: 'Déplacement à Kpalimé (visite Hôtel Sarakawa)',
    amount: 60_000,
    givenOn: day(-4),
    method: 'cash',
    reference: 'Reçu signé',
  });
  const trip = await act<Asked>(sales, 'expenses_file', {
    title: 'Déplacement à Kpalimé',
    spentOn: day(-3),
    proof: 'Tickets agrafés',
    advanceId: advance.advanceId,
    lines: [
      { label: 'Carburant', quantity: 1, unitPrice: 15_000 },
      { label: 'Repas', quantity: 2, unitPrice: 3_750 },
    ],
  });
  await act(owner, 'purchases_decide', { ...trip, decision: 'approve' });

  // The till, counted last night: 500 F short, said as it is.
  const standing = await transaction(DEMO_ORGANIZATION, (db) => treasuryStanding(db));
  const drawer = standing.accounts.find((account) => account.accountId === till.accountId);
  await act(cashier, 'till_close', {
    accountId: till.accountId,
    closedOn: day(-1),
    counted: (drawer?.balance ?? 500) - 500,
    note: 'Il manque une pièce de 500 F.',
  });
  await act(accountant, 'treasury_move', {
    accountId: standing.accounts.find((account) => account.kind === 'bank')?.accountId,
    direction: 'out',
    amount: 4_500,
    on: day(-1),
    label: 'Frais de tenue de compte',
  });
}
