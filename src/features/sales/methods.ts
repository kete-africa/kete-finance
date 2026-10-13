/** How money comes in: what a receipt says, and what the till counts by. */
export const receiptMethods = ['cash', 'bank', 'mobile', 'cheque'] as const;
export type ReceiptMethod = (typeof receiptMethods)[number];
