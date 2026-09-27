import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Deux boutiques distinctes : le jeu de données minimal permet de vérifier à la
 * main que rien ne fuit d'un marchand à l'autre.
 */
const TENANTS = [
  {
    slug: "mamalys",
    legalName: "Mamalys Couture SARL",
    countryCode: "SN",
    payoutWallet: "+221770000001",
    payoutMethod: "wave",
    products: [
      {
        title: "Ensemble bazin brodé",
        slug: "ensemble-bazin-brode",
        variants: [
          { sku: "BAZ-M", title: "Taille M", priceMinor: 45000, stock: 12 },
          { sku: "BAZ-L", title: "Taille L", priceMinor: 45000, stock: 8 },
        ],
      },
      {
        title: "Sac en tissu wax",
        slug: "sac-tissu-wax",
        variants: [{ sku: "WAX-U", title: "Taille unique", priceMinor: 18000, stock: 30 }],
      },
    ],
  },
  {
    slug: "teranga-tech",
    legalName: "Teranga Tech SUARL",
    countryCode: "SN",
    payoutWallet: "+221770000002",
    payoutMethod: "orange_money",
    products: [
      {
        title: "Batterie externe solaire",
        slug: "batterie-externe-solaire",
        variants: [{ sku: "SOL-20K", title: "20 000 mAh", priceMinor: 25000, stock: 50 }],
      },
    ],
  },
];

async function main(): Promise<void> {
  for (const definition of TENANTS) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: definition.slug },
      update: {},
      create: {
        slug: definition.slug,
        legalName: definition.legalName,
        countryCode: definition.countryCode,
        defaultCurrency: "XOF",
        status: "active",
        kycStatus: "approved",
        payoutWallet: definition.payoutWallet,
        payoutMethod: definition.payoutMethod,
      },
    });

    await prisma.domain.upsert({
      where: { hostname: `${definition.slug}.localhost` },
      update: {},
      create: { tenantId: tenant.id, hostname: `${definition.slug}.localhost`, isPrimary: true },
    });

    for (const product of definition.products) {
      const existing = await prisma.product.findFirst({
        where: { tenantId: tenant.id, slug: product.slug },
      });
      if (existing) {
        continue;
      }
      await prisma.product.create({
        data: {
          tenantId: tenant.id,
          title: product.title,
          slug: product.slug,
          status: "active",
          variants: {
            create: product.variants.map((variant) => ({ tenantId: tenant.id, ...variant })),
          },
        },
      });
    }
  }

  console.log("Seed terminé : 2 boutiques, domaines *.localhost, catalogue de démonstration");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
