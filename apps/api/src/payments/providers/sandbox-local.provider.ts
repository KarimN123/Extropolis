import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutResult,
  CreateCheckoutInput,
  CurrencyCode,
  NormalizedEvent,
  NormalizedEventType,
  PaymentContext,
  PaymentStatus,
  PayoutInput,
  PayoutResult,
  RefundResult,
} from "@extropolis/shared";
import { LOCAL_METHODS } from "@extropolis/shared";
import type { PaymentProvider, RawWebhook } from "../payment-provider";

interface SandboxCharge {
  providerRef: string;
  amountMinor: number;
  currency: CurrencyCode;
  status: PaymentStatus;
  phone?: string;
}

export const SANDBOX_WEBHOOK_SECRET = "sandbox-secret";

/**
 * Rail local en bac à sable : reproduit le comportement d'un PSP mobile money
 * (redirection hors navigateur, confirmation asynchrone, webhook signé,
 * remboursement non instantané) sans aucun appel réseau. Sert de provider par
 * défaut en développement et de double de test.
 */
@Injectable()
export class SandboxLocalProvider implements PaymentProvider {
  readonly id = "sandbox" as const;
  private readonly charges = new Map<string, SandboxCharge>();

  supports(ctx: PaymentContext): boolean {
    if (ctx.currency !== "XOF") {
      return false;
    }
    return ctx.method === undefined || LOCAL_METHODS.includes(ctx.method);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const existing = [...this.charges.values()].find(
      (charge) => charge.providerRef === input.idempotencyKey,
    );
    const providerRef = existing?.providerRef ?? `sbx_${randomUUID()}`;
    this.charges.set(providerRef, {
      providerRef,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "pending",
      phone: input.customerPhone,
    });
    const base = process.env.PUBLIC_API_URL ?? "http://localhost:4000";
    return {
      providerRef,
      status: "pending",
      redirectUrl: `${base}/sandbox/psp/${providerRef}`,
    };
  }

  async verify(providerRef: string): Promise<PaymentStatus> {
    const charge = this.charges.get(providerRef);
    if (!charge) {
      throw new NotFoundException(`Transaction sandbox inconnue: ${providerRef}`);
    }
    return charge.status;
  }

  async parseWebhook(raw: RawWebhook): Promise<NormalizedEvent> {
    const signature = raw.headers["x-sandbox-signature"];
    if (typeof signature !== "string" || !verifySignature(raw.body, signature)) {
      throw new Error("Signature sandbox invalide");
    }
    const payload = JSON.parse(raw.body.toString("utf8")) as {
      id: string;
      ref: string;
      type: NormalizedEventType;
      amountMinor?: number;
      currency?: CurrencyCode;
    };
    return {
      providerEventId: payload.id,
      providerRef: payload.ref,
      type: payload.type,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      occurredAt: new Date(),
      raw: payload,
    };
  }

  async refund(providerRef: string, amountMinor: number): Promise<RefundResult> {
    const charge = this.charges.get(providerRef);
    if (!charge) {
      throw new NotFoundException(`Transaction sandbox inconnue: ${providerRef}`);
    }
    charge.status = amountMinor >= charge.amountMinor ? "refunded" : charge.status;
    // Sur mobile money, le remboursement part en traitement manuel.
    return { providerRef: `sbxr_${randomUUID()}`, status: "pending_manual" };
  }

  async payout(input: PayoutInput): Promise<PayoutResult> {
    return { providerRef: `sbxp_${input.idempotencyKey}`, status: "succeeded" };
  }

  /** Utilisé par la page de simulation pour confirmer ou refuser un paiement. */
  settle(providerRef: string, outcome: "succeeded" | "failed"): SandboxCharge {
    const charge = this.charges.get(providerRef);
    if (!charge) {
      throw new NotFoundException(`Transaction sandbox inconnue: ${providerRef}`);
    }
    charge.status = outcome;
    return charge;
  }

  peek(providerRef: string): SandboxCharge | undefined {
    return this.charges.get(providerRef);
  }
}

export function signSandboxPayload(body: Buffer | string): string {
  return createHmac("sha256", SANDBOX_WEBHOOK_SECRET).update(body).digest("hex");
}

function verifySignature(body: Buffer, signature: string): boolean {
  const expected = Buffer.from(signSandboxPayload(body), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
