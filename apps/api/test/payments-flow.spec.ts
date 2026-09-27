import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { runWithTenant } from "../src/prisma/tenant-context";
import { LedgerService } from "../src/ledger/ledger.service";
import { PaymentRouterService } from "../src/payments/payment-router.service";
import { PaymentsService } from "../src/payments/payments.service";
import { SandboxLocalProvider } from "../src/payments/providers/sandbox-local.provider";
import { StripeProvider } from "../src/payments/providers/stripe.provider";
import { OrdersService } from "../src/orders/orders.service";

process.env.PLATFORM_FEE_BPS = "250";

const prisma = new PrismaService();
const sandbox = new SandboxLocalProvider();
const router = new PaymentRouterService([sandbox, new StripeProvider()]);
const ledger = new LedgerService(prisma);
const payments = new PaymentsService(prisma, router, ledger);
const orders = new OrdersService(prisma);

const CHECKOUT_URLS = { returnUrl: "http://shop.localhost/merci", cancelUrl: "http://shop.localhost" };

async function createPaidOrder(tenantId: string, variantId: string) {
  const order = await runWithTenant({ tenantId }, () =>
    orders.create({ items: [{ variantId, quantity: 1 }], customer: { phone: `+2217700${Date.now() % 100000}` } }),
  );
  const { checkout } = await runWithTenant({ tenantId }, () =>
    payments.startCheckout(order.id, { method: "wave", ...CHECKOUT_URLS }),
  );
  return { order, providerRef: checkout.providerRef };
}

describe("parcours de paiement local", () => {
  let tenantId: string;
  let variantId: string;

  beforeAll(async () => {
    const tenant = await prisma.asPlatform((tx) =>
      tx.tenant.findFirstOrThrow({ where: { slug: "mamalys" } }),
    );
    tenantId = tenant.id;
    const variant = await prisma.asPlatform((tx) =>
      tx.variant.findFirstOrThrow({ where: { tenantId } }),
    );
    variantId = variant.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("route le XOF vers le rail local et l'EUR vers Stripe", () => {
    expect(router.select({ currency: "XOF", method: "wave" }).id).toBe("sandbox");
    expect(router.candidates({ currency: "XOF" }).map((provider) => provider.id)).not.toContain(
      "stripe",
    );
    expect(router.candidates({ currency: "EUR", method: "wave" })).toHaveLength(0);
  });

  it("laisse la commande impayée tant que la passerelle n'a pas confirmé", async () => {
    const { order } = await createPaidOrder(tenantId, variantId);
    const stored = await runWithTenant({ tenantId }, () => orders.get(order.id));
    expect(stored.status).toBe("awaiting_payment");
    expect(stored.paymentIntents[0]!.status).toBe("pending");
  });

  it("encaisse la commande sur webhook et inscrit vente + commission au grand livre", async () => {
    const { order, providerRef } = await createPaidOrder(tenantId, variantId);
    const before = await ledger.balance(tenantId, "XOF");

    sandbox.settle(providerRef, "succeeded");
    const applied = await payments.applyEvent("sandbox", {
      providerEventId: randomUUID(),
      providerRef,
      type: "payment.succeeded",
      occurredAt: new Date(),
      raw: {},
    });

    expect(applied.applied).toBe(true);
    const stored = await runWithTenant({ tenantId }, () => orders.get(order.id));
    expect(stored.status).toBe("paid");

    const entries = await prisma.asPlatform((tx) =>
      tx.ledgerEntry.findMany({ where: { orderId: order.id } }),
    );
    const sale = entries.find((entry) => entry.type === "sale")!;
    const fee = entries.find((entry) => entry.type === "platform_fee")!;
    expect(sale.amountMinor).toBe(order.totalMinor);
    expect(fee.amountMinor).toBe(Math.round((order.totalMinor * 250) / 10_000));
    expect(await ledger.balance(tenantId, "XOF")).toBe(
      before + sale.amountMinor - fee.amountMinor,
    );
  });

  it("ignore un webhook rejoué et n'inscrit la vente qu'une fois", async () => {
    const { order, providerRef } = await createPaidOrder(tenantId, variantId);
    sandbox.settle(providerRef, "succeeded");
    const event = {
      providerEventId: randomUUID(),
      providerRef,
      type: "payment.succeeded" as const,
      occurredAt: new Date(),
      raw: {},
    };

    expect((await payments.applyEvent("sandbox", event)).applied).toBe(true);
    expect((await payments.applyEvent("sandbox", event)).applied).toBe(false);

    const sales = await prisma.asPlatform((tx) =>
      tx.ledgerEntry.findMany({ where: { orderId: order.id, type: "sale" } }),
    );
    expect(sales).toHaveLength(1);
  });

  it("rattrape un webhook perdu par vérification serveur", async () => {
    const { order, providerRef } = await createPaidOrder(tenantId, variantId);
    // Le PSP encaisse mais n'émet jamais de notification.
    sandbox.settle(providerRef, "succeeded");

    const settled = await payments.pollPending(new Date(Date.now() + 60_000));
    expect(settled).toBeGreaterThanOrEqual(1);

    const stored = await runWithTenant({ tenantId }, () => orders.get(order.id));
    expect(stored.status).toBe("paid");
  });

  it("ne crédite rien quand le paiement échoue", async () => {
    const { order, providerRef } = await createPaidOrder(tenantId, variantId);
    sandbox.settle(providerRef, "failed");

    await payments.applyEvent("sandbox", {
      providerEventId: randomUUID(),
      providerRef,
      type: "payment.failed",
      occurredAt: new Date(),
      raw: {},
    });

    const stored = await runWithTenant({ tenantId }, () => orders.get(order.id));
    expect(stored.status).toBe("awaiting_payment");
    const entries = await prisma.asPlatform((tx) =>
      tx.ledgerEntry.findMany({ where: { orderId: order.id } }),
    );
    expect(entries).toHaveLength(0);
  });
});
