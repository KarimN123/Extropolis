import { Injectable } from "@nestjs/common";
import type { CurrencyCode } from "@extropolis/shared";
import { splitMinor } from "@extropolis/shared";
import { PrismaService, type TenantClient } from "../prisma/prisma.service";

export interface SaleInput {
  tenantId: string;
  orderId: string;
  amountMinor: number;
  currency: CurrencyCode;
}

/**
 * Grand livre append-only.
 *
 * Modèle « la plateforme encaisse puis reverse » : les fonds arrivent sur les
 * comptes de la plateforme (Stripe → Mercury, PSP local → compte marchand
 * plateforme). Le solde d'un marchand n'est jamais un champ mis à jour, c'est
 * toujours la somme de ses écritures.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  static platformFeeBps(): number {
    return Number.parseInt(process.env.PLATFORM_FEE_BPS ?? "250", 10);
  }

  /** Inscrit la vente et la commission. Idempotent par (orderId, type). */
  async recordSale(tx: TenantClient, input: SaleInput): Promise<void> {
    const existing = await tx.ledgerEntry.findFirst({
      where: { orderId: input.orderId, type: "sale" },
    });
    if (existing) {
      return;
    }

    const { fee } = splitMinor(input.amountMinor, LedgerService.platformFeeBps());
    await tx.ledgerEntry.createMany({
      data: [
        {
          tenantId: input.tenantId,
          orderId: input.orderId,
          type: "sale",
          direction: "credit",
          amountMinor: input.amountMinor,
          currency: input.currency,
          memo: "Encaissement client",
        },
        {
          tenantId: input.tenantId,
          orderId: input.orderId,
          type: "platform_fee",
          direction: "debit",
          amountMinor: fee,
          currency: input.currency,
          memo: `Commission plateforme ${LedgerService.platformFeeBps() / 100}%`,
        },
      ],
    });
  }

  async recordRefund(
    tx: TenantClient,
    input: SaleInput & { refundedMinor: number },
  ): Promise<void> {
    await tx.ledgerEntry.create({
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        type: "refund",
        direction: "debit",
        amountMinor: input.refundedMinor,
        currency: input.currency,
        memo: "Remboursement client",
      },
    });
  }

  async recordPayout(
    tx: TenantClient,
    input: { tenantId: string; payoutId: string; amountMinor: number; currency: CurrencyCode },
  ): Promise<void> {
    await tx.ledgerEntry.create({
      data: {
        tenantId: input.tenantId,
        payoutId: input.payoutId,
        type: "payout",
        direction: "debit",
        amountMinor: input.amountMinor,
        currency: input.currency,
        memo: "Reversement marchand",
      },
    });
  }

  /** Solde reversable du marchand, par devise. */
  async balance(tenantId: string, currency: CurrencyCode): Promise<number> {
    return this.prisma.asPlatform(async (tx) => {
      const grouped = await tx.ledgerEntry.groupBy({
        by: ["direction"],
        where: { tenantId, currency },
        _sum: { amountMinor: true },
      });
      return grouped.reduce((total, row) => {
        const amount = row._sum.amountMinor ?? 0;
        return row.direction === "credit" ? total + amount : total - amount;
      }, 0);
    });
  }
}
