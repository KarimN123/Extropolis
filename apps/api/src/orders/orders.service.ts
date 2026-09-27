import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { requireTenant } from "../prisma/tenant-context";

export interface CreateOrderInput {
  items: { variantId: string; quantity: number }[];
  customer?: { email?: string; phone?: string; fullName?: string };
  shippingMinor?: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le total est recalculé à partir des prix en base : le client n'envoie que
   * des variantes et des quantités, jamais un montant.
   */
  async create(input: CreateOrderInput) {
    const { tenantId } = requireTenant();
    if (input.items.length === 0) {
      throw new BadRequestException("Panier vide");
    }

    return this.prisma.withTenant(async (tx) => {
      const variants = await tx.variant.findMany({
        where: { id: { in: input.items.map((item) => item.variantId) } },
      });
      if (variants.length !== input.items.length) {
        throw new NotFoundException("Variante introuvable dans cette boutique");
      }

      const currency = variants[0]!.currency;
      if (variants.some((variant) => variant.currency !== currency)) {
        throw new BadRequestException("Panier multi-devises non supporté");
      }

      const lines = input.items.map((item) => {
        const variant = variants.find((candidate) => candidate.id === item.variantId)!;
        if (item.quantity < 1) {
          throw new BadRequestException("Quantité invalide");
        }
        if (variant.stock < item.quantity) {
          throw new BadRequestException(`Stock insuffisant pour ${variant.sku}`);
        }
        return {
          tenantId,
          variantId: variant.id,
          title: variant.title,
          quantity: item.quantity,
          unitPriceMinor: variant.priceMinor,
        };
      });

      const subtotalMinor = lines.reduce(
        (total, line) => total + line.unitPriceMinor * line.quantity,
        0,
      );
      const shippingMinor = input.shippingMinor ?? 0;

      const customer = input.customer?.phone
        ? await tx.customer.upsert({
            where: { tenantId_phone: { tenantId, phone: input.customer.phone } },
            create: {
              tenantId,
              phone: input.customer.phone,
              email: input.customer.email,
              fullName: input.customer.fullName,
            },
            update: { email: input.customer.email, fullName: input.customer.fullName },
          })
        : null;

      return tx.order.create({
        data: {
          tenantId,
          number: `CMD-${Date.now().toString(36).toUpperCase()}`,
          customerId: customer?.id,
          status: "draft",
          currency,
          subtotalMinor,
          shippingMinor,
          totalMinor: subtotalMinor + shippingMinor,
          items: { create: lines },
        },
        include: { items: true },
      });
    });
  }

  get(id: string) {
    return this.prisma.withTenant(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, paymentIntents: true },
      });
      if (!order) {
        throw new NotFoundException("Commande introuvable");
      }
      return order;
    });
  }

  list() {
    return this.prisma.withTenant((tx) =>
      tx.order.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { items: true } }),
    );
  }
}
