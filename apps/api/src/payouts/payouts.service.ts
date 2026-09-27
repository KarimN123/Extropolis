import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { CurrencyCode, PaymentMethodKind } from "@extropolis/shared";
import { PrismaService } from "../prisma/prisma.service";
import { requireTenant } from "../prisma/tenant-context";
import { LedgerService } from "../ledger/ledger.service";
import { PaymentRouterService } from "../payments/payment-router.service";

/**
 * Reversements marchands.
 *
 * Les fonds encaissés (Stripe → compte bancaire de la plateforme, PSP local →
 * compte plateforme) sont redistribués vers le wallet Wave / Orange Money du
 * marchand. Le montant demandé est borné par le solde du grand livre, et
 * l'écriture de débit est posée dans la même transaction que le payout pour
 * qu'une double demande concurrente ne puisse pas dépasser le solde.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly router: PaymentRouterService,
  ) {}

  async balance(currency: CurrencyCode = "XOF") {
    const { tenantId } = requireTenant();
    return { currency, availableMinor: await this.ledger.balance(tenantId, currency) };
  }

  async request(input: { amountMinor: number; currency?: CurrencyCode }) {
    const { tenantId } = requireTenant();
    const currency = input.currency ?? "XOF";
    if (input.amountMinor <= 0) {
      throw new BadRequestException("Montant invalide");
    }

    const payout = await this.prisma.withTenant(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant?.payoutWallet || !tenant.payoutMethod) {
        throw new BadRequestException("Aucun wallet de reversement configuré");
      }
      if (tenant.kycStatus !== "approved") {
        throw new BadRequestException("KYC non validé : reversement bloqué");
      }

      const available = await this.ledger.balance(tenantId, currency);
      if (input.amountMinor > available) {
        throw new BadRequestException(`Solde insuffisant (${available} ${currency})`);
      }

      const created = await tx.payout.create({
        data: {
          tenantId,
          amountMinor: input.amountMinor,
          currency,
          method: tenant.payoutMethod,
          destination: tenant.payoutWallet,
        },
      });
      await this.ledger.recordPayout(tx, {
        tenantId,
        payoutId: created.id,
        amountMinor: input.amountMinor,
        currency,
      });
      return created;
    });

    return this.execute(payout.id);
  }

  /** Exécution auprès du PSP. Rejouable : le statut sert de garde. */
  async execute(payoutId: string) {
    return this.prisma.asPlatform(async (tx) => {
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      if (payout.status !== "requested") {
        return payout;
      }

      const provider = this.router.select({
        currency: payout.currency as CurrencyCode,
        method: payout.method as PaymentMethodKind,
      });
      if (!provider.payout) {
        this.logger.warn(`Passerelle ${provider.id} sans API de reversement`);
        return tx.payout.update({ where: { id: payout.id }, data: { status: "processing" } });
      }

      try {
        const result = await provider.payout({
          tenantId: payout.tenantId,
          amountMinor: payout.amountMinor,
          currency: payout.currency as CurrencyCode,
          destination: payout.destination,
          method: payout.method as PaymentMethodKind,
          idempotencyKey: payout.id,
        });
        return tx.payout.update({
          where: { id: payout.id },
          data: {
            status: result.status === "succeeded" ? "paid" : "processing",
            providerRef: result.providerRef,
          },
        });
      } catch (error) {
        this.logger.error(`Reversement ${payout.id} échoué`, error);
        // Le débit reste au grand livre tant que l'échec n'est pas constaté :
        // une écriture d'ajustement le compense explicitement.
        await tx.ledgerEntry.create({
          data: {
            tenantId: payout.tenantId,
            payoutId: payout.id,
            type: "adjustment",
            direction: "credit",
            amountMinor: payout.amountMinor,
            currency: payout.currency,
            memo: "Reversement échoué, montant restitué au solde",
          },
        });
        return tx.payout.update({
          where: { id: payout.id },
          data: { status: "failed", failureCode: "provider_error" },
        });
      }
    });
  }

  list() {
    const { tenantId } = requireTenant();
    return this.prisma.withTenant((tx) =>
      tx.payout.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }),
    );
  }
}
