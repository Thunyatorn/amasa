// Prices in the celebrity store are VU, the celebrity market's unit (1 VU = $1.00 in this demo).
// Amounts are integer cents everywhere; this is the one formatter for what the user reads.
export const vu = (cents: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} VU`;
export const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
