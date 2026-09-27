import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PaymentIntent } from "@prisma/client";
import type {
  CheckoutResult,
  CurrencyCode,
  NormalizedEvent,
  PaymentMethodKind,
  PaymentStatus,
} from "@extropolis/shared";
import { PrismaService, type TenantClient } from "../prisma/prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import { PaymentRouterService } from "./payment-router.service";
import type { RawWebhook } from "./payment-provider";

/** Un webhook peut être perdu : le paiement est revérifié activement à ces délais. */
const POLL_SCHEDULE_SECONDS = [10, 30, 120, 300, 900];

const EVENT_TO_STATUS: Record<NormalizedEvent["type"], PaymentStatus> = {
  "payment.pending": "pending",
  "payment.succeeded": "succeeded",
  "payment.failed": "failed",
  "payment.cancelled": "cancelled",
  "payment.refunded": "refunded",
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: PaymentRouterService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Démarre un paiement pour une commande. L'intent est créé avant l'appel à la
   * passerelle : un webhook qui arriverait immédiatement retrouve sa commande.
   */
  async startCheckout(
    orderId: string,
    options: { method?: PaymentMethodKind; returnUrl: string; cancelUrl: string },
  ): Promise<{ paymentIntentId: string; checkout: CheckoutResult }> {
    return this.prisma.withTenant(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });
      if (!order) {
        throw new NotFoundException("Commande introuvable");
      }
      if (order.status === "paid") {
        throw new BadRequestException("Commande déjà payée");
      }

      const currency = order.currency as CurrencyCode;
      const provider = this.router.select({ currency, method: options.method });
      const attempt = order.paymentAttempt + 1;
      const idempotencyKey = `${order.id}:${attempt}`;

      const intent = await tx.paymentIntent.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          provider: provider.id,
          method: options.method,
          idempotencyKey,
          amountMinor: order.totalMinor,
          currency,
        },
      });

      const checkout = await provider.createCheckout({
        tenantId: order.tenantId,
        orderId: order.id,
        idempotencyKey,
        amountMinor: order.totalMinor,
        currency,
        method: options.method,
        customerEmail: order.customer?.email ?? undefined,
        customerPhone: order.customer?.phone ?? undefined,
        returnUrl: options.returnUrl,
        cancelUrl: options.cancelUrl,
      });

      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          providerRef: checkout.providerRef,
          redirectUrl: checkout.redirectUrl,
          nextPollAt: nextPollDate(0),
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "awaiting_payment",
          paymentAttempt: attempt,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });

      return { paymentIntentId: intent.id, checkout };
    });
  }

  /**
   * Entrée unique des webhooks. L'événement est persisté brut puis appliqué ;
   * la contrainte unique `(provider, providerEventId)` rend le rejeu inoffensif.
   */
  async ingestWebhook(providerId: string, raw: RawWebhook): Promise<{ applied: boolean }> {
    const provider = this.router.byId(providerId);
    const event = await provider.parseWebhook(raw);
    return this.applyEvent(providerId, event);
  }

  async applyEvent(providerId: string, event: NormalizedEvent): Promise<{ applied: boolean }> {
    return this.prisma.asPlatform(async (tx) => {
      const intent = await tx.paymentIntent.findFirst({
        where: { provider: providerId, providerRef: event.providerRef },
      });

      try {
        await tx.paymentEvent.create({
          data: {
            tenantId: intent?.tenantId,
            paymentIntentId: intent?.id,
            provider: providerId,
            providerEventId: event.providerEventId,
            type: event.type,
            payload: JSON.parse(JSON.stringify(event.raw)),
          },
        });
      } catch (error) {
        if (PrismaService.isUniqueViolation(error)) {
          return { applied: false };
        }
        throw error;
      }

      if (!intent) {
        this.logger.warn(`Événement ${event.providerEventId} sans intent connu`);
        return { applied: false };
      }

      await this.transition(tx, intent, EVENT_TO_STATUS[event.type]);
      await tx.paymentEvent.updateMany({
        where: { provider: providerId, providerEventId: event.providerEventId },
        data: { processedAt: new Date() },
      });
      return { applied: true };
    });
  }

  /**
   * Vérification serveur-à-serveur des paiements encore en attente. C'est ce
   * qui rattrape les webhooks mobile money perdus.
   */
  async pollPending(now = new Date()): Promise<number> {
    const pending = await this.prisma.asPlatform((tx) =>
      tx.paymentIntent.findMany({
        where: { status: "pending", nextPollAt: { lte: now } },
        take: 100,
      }),
    );

    let settled = 0;
    for (const intent of pending) {
      if (!intent.providerRef) {
        continue;
      }
      try {
        const status = await this.router.byId(intent.provider).verify(intent.providerRef);
        await this.prisma.asPlatform(async (tx) => {
          if (status === "pending") {
            await tx.paymentIntent.update({
              where: { id: intent.id },
              data: {
                pollAttempts: intent.pollAttempts + 1,
                nextPollAt: nextPollDate(intent.pollAttempts + 1),
              },
            });
            return;
          }
          await this.transition(tx, intent, status);
          settled += 1;
        });
      } catch (error) {
        this.logger.error(`Vérification ${intent.provider}/${intent.providerRef} échouée`, error);
      }
    }
    return settled;
  }

  async refund(paymentIntentId: string, amountMinor?: number): Promise<{ status: string }> {
    return this.prisma.withTenant(async (tx) => {
      const intent = await tx.paymentIntent.findUnique({ where: { id: paymentIntentId } });
      if (!intent || !intent.providerRef) {
        throw new NotFoundException("Paiement introuvable");
      }
      if (intent.status !== "succeeded") {
        throw new BadRequestException("Seul un paiement abouti peut être remboursé");
      }

      const amount = amountMinor ?? intent.amountMinor;
      const result = await this.router.byId(intent.provider).refund(intent.providerRef, amount);

      await tx.refund.create({
        data: {
          tenantId: intent.tenantId,
          paymentIntentId: intent.id,
          amountMinor: amount,
          currency: intent.currency,
          status: result.status === "succeeded" ? "succeeded" : result.status,
          providerRef: result.providerRef,
        },
      });
      await this.ledger.recordRefund(tx, {
        tenantId: intent.tenantId,
        orderId: intent.orderId,
        amountMinor: intent.amountMinor,
        currency: intent.currency as CurrencyCode,
        refundedMinor: amount,
      });

      return { status: result.status };
    });
  }

  /**
   * Écart entre ce que la passerelle déclare et ce que la base enregistre.
   * Exécuté tous les jours, c'est le filet qui détecte les paiements encaissés
   * mais jamais validés côté boutique.
   */
  async reconcile(since: Date): Promise<{ checked: number; mismatches: string[] }> {
    const intents = await this.prisma.asPlatform((tx) =>
      tx.paymentIntent.findMany({ where: { createdAt: { gte: since } }, take: 500 }),
    );

    const mismatches: string[] = [];
    for (const intent of intents) {
      if (!intent.providerRef) {
        continue;
      }
      try {
        const remote = await this.router.byId(intent.provider).verify(intent.providerRef);
        if (remote !== intent.status) {
          mismatches.push(`${intent.id}: local=${intent.status} distant=${remote}`);
          await this.prisma.asPlatform((tx) => this.transition(tx, intent, remote));
        }
      } catch (error) {
        this.logger.error(`Réconciliation impossible pour ${intent.id}`, error);
      }
    }
    return { checked: intents.length, mismatches };
  }

  private async transition(
    tx: TenantClient,
    intent: PaymentIntent,
    status: PaymentStatus,
  ): Promise<void> {
    if (intent.status === status) {
      return;
    }

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status, nextPollAt: status === "pending" ? intent.nextPollAt : null },
    });

    if (status === "succeeded") {
      await tx.order.update({ where: { id: intent.orderId }, data: { status: "paid" } });
      await this.ledger.recordSale(tx, {
        tenantId: intent.tenantId,
        orderId: intent.orderId,
        amountMinor: intent.amountMinor,
        currency: intent.currency as CurrencyCode,
      });
      return;
    }

    if (status === "failed" || status === "cancelled") {
      // La commande reste ré-essayable : le client peut repartir sur l'autre rail.
      await tx.order.update({
        where: { id: intent.orderId },
        data: { status: "awaiting_payment" },
      });
    }
  }
}

function nextPollDate(attempt: number): Date {
  const seconds =
    POLL_SCHEDULE_SECONDS[Math.min(attempt, POLL_SCHEDULE_SECONDS.length - 1)] ??
    POLL_SCHEDULE_SECONDS[POLL_SCHEDULE_SECONDS.length - 1];
  return new Date(Date.now() + (seconds ?? 900) * 1000);
}
