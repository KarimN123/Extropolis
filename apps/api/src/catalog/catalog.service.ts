import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { requireTenant } from "../prisma/tenant-context";

export interface CreateProductInput {
  title: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  variants: { sku: string; title: string; priceMinor: number; stock: number }[];
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catalogue public : seuls les produits actifs de la boutique courante. */
  listPublic() {
    return this.prisma.withTenant((tx) =>
      tx.product.findMany({
        where: { status: "active" },
        include: { variants: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  listAll() {
    return this.prisma.withTenant((tx) =>
      tx.product.findMany({ include: { variants: true }, orderBy: { createdAt: "desc" } }),
    );
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.withTenant((tx) =>
      tx.product.findFirst({ where: { slug, status: "active" }, include: { variants: true } }),
    );
    if (!product) {
      throw new NotFoundException("Produit introuvable");
    }
    return product;
  }

  create(input: CreateProductInput) {
    const { tenantId } = requireTenant();
    return this.prisma.withTenant((tx) =>
      tx.product.create({
        data: {
          tenantId,
          title: input.title,
          slug: input.slug,
          description: input.description,
          imageUrl: input.imageUrl,
          status: "active",
          variants: {
            create: input.variants.map((variant) => ({
              tenantId,
              sku: variant.sku,
              title: variant.title,
              priceMinor: variant.priceMinor,
              stock: variant.stock,
            })),
          },
        },
        include: { variants: true },
      }),
    );
  }
}
