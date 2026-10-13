// The kinds of accounts and the ways of paying, alone: a screen reads them without the rules.

export const accountKinds = ['bank', 'till', 'mobile'] as const;
export type AccountKind = (typeof accountKinds)[number];
export type Method = 'cash' | 'bank' | 'mobile' | 'cheque';

/** Where money goes by how it came: cash to a till, a transfer or a cheque to a bank account. */
export function kindOfMethod(method: Method): AccountKind {
  return method === 'cash' ? 'till' : method === 'mobile' ? 'mobile' : 'bank';
}
