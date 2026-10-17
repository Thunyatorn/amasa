import { createLink, newPurchaseNumber } from "./visa";

// M0 smoke test: create one $1.00 SANDBOX payment link and log the raw response once,
// so we can see which field holds the link URL (SPEC §10.4, §20 item 1).
async function main(): Promise<void> {
  for (const name of ["VISA_ACCEPTANCE_MERCHANT_ID", "VISA_ACCEPTANCE_API_KEY_ID", "VISA_ACCEPTANCE_SECRET_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set in services/payments/.env`);
  }

  const purchaseNumber = newPurchaseNumber();
  const result = await createLink({
    fields: { purchaseNumber, totalCents: 100 },
    lines: [{ sku: "LINK-TEST", title: "Amasa link test", qty: 1, unitCents: 100 }],
    taxCents: 0,
    shippingCents: 0,
  });

  console.log(`purchaseNumber: ${purchaseNumber}`);
  console.log("raw sandbox response:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(`link:test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
