import { PrismaClient } from "@prisma/client";

/**
 * Vérifie l'isolation au niveau PostgreSQL, pas au niveau applicatif : les
 * requêtes sont volontairement écrites sans aucun filtre `tenantId`. Ce qui
 * protège ici, c'est le RLS et le rôle non propriétaire.
 *
 * Nécessite la base de développement migrée et peuplée (`pnpm db:migrate && pnpm db:seed`).
 */
const APP_URL =
  process.env.APP_DATABASE_URL ??
  "postgresql://extropolis_app:extropolis_app@localhost:5432/extropolis?schema=public";

const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const app = new PrismaClient({ datasources: { db: { url: APP_URL } } });

async function asTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.tenant_id', ${tenantId}::text, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

describe("isolation multi-tenant (RLS)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const tenants = await owner.tenant.findMany({ orderBy: { slug: "asc" } });
    if (tenants.length < 2) {
      throw new Error("Base de test non peuplée : lancer pnpm db:seed");
    }
    tenantA = tenants[0]!.id;
    tenantB = tenants[1]!.id;
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  it("ne renvoie que les produits du tenant courant, sans filtre applicatif", async () => {
    const [productsA, productsB] = await Promise.all([
      asTenant(tenantA, (tx) => tx.product.findMany()),
      asTenant(tenantB, (tx) => tx.product.findMany()),
    ]);

    expect(productsA.length).toBeGreaterThan(0);
    expect(productsB.length).toBeGreaterThan(0);
    expect(productsA.every((product) => product.tenantId === tenantA)).toBe(true);
    expect(productsB.every((product) => product.tenantId === tenantB)).toBe(true);
  });

  it("rend invisible une ligne d'un autre tenant, même interrogée par son id", async () => {
    const productB = await owner.product.findFirstOrThrow({ where: { tenantId: tenantB } });
    const seenFromA = await asTenant(tenantA, (tx) =>
      tx.product.findUnique({ where: { id: productB.id } }),
    );
    expect(seenFromA).toBeNull();
  });

  it("refuse l'écriture pour le compte d'un autre tenant", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        tx.product.create({
          data: { tenantId: tenantB, title: "Fuite", slug: `fuite-${Date.now()}` },
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuse la mise à jour d'une écriture du grand livre (append-only)", async () => {
    const entry = await owner.ledgerEntry.create({
      data: {
        tenantId: tenantA,
        type: "adjustment",
        direction: "credit",
        amountMinor: 1000,
        currency: "XOF",
        memo: "test append-only",
      },
    });

    await expect(
      asTenant(tenantA, (tx) =>
        tx.ledgerEntry.update({ where: { id: entry.id }, data: { amountMinor: 999_999 } }),
      ),
    ).rejects.toThrow();

    await owner.ledgerEntry.delete({ where: { id: entry.id } });
  });

  it("ne voit aucune ligne sans tenant positionné", async () => {
    const products = await app.$transaction((tx) => tx.product.findMany());
    expect(products).toHaveLength(0);
  });
});
