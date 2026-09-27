import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import type {
  CheckoutResult,
  CreateCheckoutInput,
  CurrencyCode,
  NormalizedEvent,
  NormalizedEventType,
  PaymentContext,
  PaymentStatus,
  RefundResult,
} from "@extropolis/shared";
import type { PaymentProvider, RawWebhook } from "../payment-provider";

const SUPPORTED_CURRENCIES: CurrencyCode[] = ["EUR", "USD"];

const EVENT_MAP: Record<string, NormalizedEventType> = {
  "payment_intent.succeeded": "payment.succeeded",
  "payment_intent.payment_failed": "payment.failed",
  "payment_intent.canceled": "payment.cancelled",
  "charge.refunded": "payment.refunded",
};

/**
 * Rail international. Les fonds arrivent sur le compte de la plateforme
 * (modèle « la plateforme encaisse puis reverse ») : pas de compte connecté,
 * la part marchand est inscrite au grand livre puis reversée en payout.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  private readonly logger = new Logger(StripeProvider.name);
  private readonly client: Stripe | null;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    this.client = key ? new Stripe(key, { apiVersion: "2024-11-20.acacia" }) : null;
    if (!this.client) {
      this.logger.warn("STRIPE_SECRET_KEY absent : le rail international est désactivé.");
    }
  }

  supports(ctx: PaymentContext): boolean {
    if (!this.client) {
      return false;
    }
    if (ctx.method && ctx.method !== "card") {
      return false;
    }
    return SUPPORTED_CURRENCIES.includes(ctx.currency);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const client = this.requireClient();
    const intent = await client.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        receipt_email: input.customerEmail,
        metadata: {
          tenantId: input.tenantId,
          orderId: input.orderId,
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );

    return {
      providerRef: intent.id,
      status: "pending",
      clientSecret: intent.client_secret ?? undefined,
    };
  }

  async verify(providerRef: string): Promise<PaymentStatus> {
    const client = this.requireClient();
    const intent = await client.paymentIntents.retrieve(providerRef);
    switch (intent.status) {
      case "succeeded":
        return "succeeded";
      case "canceled":
        return "cancelled";
      case "requires_payment_method":
        return intent.last_payment_error ? "failed" : "pending";
      default:
        return "pending";
    }
  }

  async parseWebhook(raw: RawWebhook): Promise<NormalizedEvent> {
    const client = this.requireClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException("STRIPE_WEBHOOK_SECRET non configuré");
    }
    const signature = raw.headers["stripe-signature"];
    if (typeof signature !== "string") {
      throw new Error("Signature Stripe manquante");
    }

    const event = client.webhooks.constructEvent(raw.body, signature, secret);
    const type = EVENT_MAP[event.type] ?? "payment.pending";
    const object = event.data.object as Stripe.PaymentIntent | Stripe.Charge;
    const providerRef =
      "payment_intent" in object && typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.id;

    return {
      providerEventId: event.id,
      providerRef,
      type,
      amountMinor: "amount" in object ? (object.amount ?? undefined) : undefined,
      currency: "currency" in object ? (object.currency.toUpperCase() as CurrencyCode) : undefined,
      occurredAt: new Date(event.created * 1000),
      raw: event,
    };
  }

  async refund(providerRef: string, amountMinor: number): Promise<RefundResult> {
    const client = this.requireClient();
    const refund = await client.refunds.create({
      payment_intent: providerRef,
      amount: amountMinor,
    });
    return {
      providerRef: refund.id,
      status: refund.status === "succeeded" ? "succeeded" : "pending",
    };
  }

  private requireClient(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException("Rail Stripe non configuré");
    }
    return this.client;
  }
}
