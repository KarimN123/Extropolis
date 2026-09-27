import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type {
  CheckoutResult,
  CreateCheckoutInput,
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

const TEST_BASE = "https://app.paydunya.com/sandbox-api/v1";
const LIVE_BASE = "https://app.paydunya.com/api/v1";

const STATUS_MAP: Record<string, PaymentStatus> = {
  completed: "succeeded",
  pending: "pending",
  cancelled: "cancelled",
  canceled: "cancelled",
  failed: "failed",
};

const EVENT_MAP: Record<PaymentStatus, NormalizedEventType> = {
  succeeded: "payment.succeeded",
  pending: "payment.pending",
  cancelled: "payment.cancelled",
  failed: "payment.failed",
  refunded: "payment.refunded",
};

interface CreateInvoiceResponse {
  response_code: string;
  response_text: string;
  token?: string;
}

interface ConfirmResponse {
  response_code: string;
  hash?: string;
  status?: string;
  invoice?: { token?: string; total_amount?: string | number };
}

/**
 * Rail local en production : PayDunya agrège Wave, Orange Money, Free Money,
 * Moov et les cartes GIM-UEMOA derrière une seule intégration.
 *
 * Endpoints et format de réponse issus de la documentation officielle
 * (developers.paydunya.com, « HTTP/JSON »). Le chemin `checkout-invoice/confirm/{token}`
 * suit les SDK officiels ; à valider avec des clés sandbox avant mise en production.
 */
@Injectable()
export class PaydunyaProvider implements PaymentProvider {
  readonly id = "paydunya" as const;
  private readonly logger = new Logger(PaydunyaProvider.name);

  supports(ctx: PaymentContext): boolean {
    if (!this.configured()) {
      return false;
    }
    if (ctx.currency !== "XOF") {
      return false;
    }
    return ctx.method === undefined || LOCAL_METHODS.includes(ctx.method);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const body = {
      invoice: {
        total_amount: input.amountMinor,
        description: `Commande ${input.orderId}`,
        customer: {
          email: input.customerEmail,
          phone: input.customerPhone,
        },
      },
      store: { name: process.env.PLATFORM_STORE_NAME ?? "Extropolis" },
      actions: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        callback_url: `${process.env.PUBLIC_API_URL ?? ""}/payments/webhooks/paydunya`,
      },
      custom_data: {
        tenant_id: input.tenantId,
        order_id: input.orderId,
        idempotency_key: input.idempotencyKey,
      },
    };

    const res = await this.request<CreateInvoiceResponse>("POST", "/checkout-invoice/create", body);
    if (res.response_code !== "00" || !res.token) {
      throw new ServiceUnavailableException(`PayDunya: ${res.response_text}`);
    }

    return {
      providerRef: res.token,
      status: "pending",
      redirectUrl: res.response_text,
    };
  }

  async verify(providerRef: string): Promise<PaymentStatus> {
    const res = await this.request<ConfirmResponse>(
      "GET",
      `/checkout-invoice/confirm/${providerRef}`,
    );
    return STATUS_MAP[(res.status ?? "").toLowerCase()] ?? "pending";
  }

  /**
   * L'IPN arrive en `application/x-www-form-urlencoded` et porte un `hash`
   * égal au SHA-512 de la clé maître : il authentifie l'émetteur mais ne
   * couvre pas le contenu, d'où la revérification systématique via `verify`.
   */
  async parseWebhook(raw: RawWebhook): Promise<NormalizedEvent> {
    const params = new URLSearchParams(raw.body.toString("utf8"));
    const hash = params.get("data[hash]");
    if (!hash || !this.verifyHash(hash)) {
      throw new Error("Hash PayDunya invalide");
    }

    const token = params.get("data[invoice][token]");
    if (!token) {
      throw new Error("Token PayDunya absent de l'IPN");
    }

    const status = await this.verify(token);
    const amount = params.get("data[invoice][total_amount]");

    return {
      providerEventId: `${token}:${status}`,
      providerRef: token,
      type: EVENT_MAP[status],
      amountMinor: amount ? Number.parseInt(amount, 10) : undefined,
      currency: "XOF",
      occurredAt: new Date(),
      raw: Object.fromEntries(params.entries()),
    };
  }

  /**
   * PayDunya n'expose pas de remboursement en libre-service : le montant est
   * renvoyé par un transfert sortant validé manuellement côté console.
   */
  async refund(providerRef: string, _amountMinor: number): Promise<RefundResult> {
    this.logger.warn(`Remboursement PayDunya ${providerRef} à traiter manuellement`);
    return { providerRef, status: "pending_manual" };
  }

  /** Reversement marchand : crédit direct d'un wallet Wave / Orange Money. */
  async payout(input: PayoutInput): Promise<PayoutResult> {
    const res = await this.request<{ response_code: string; response_text: string }>(
      "POST",
      "/direct-pay/credit-account",
      { account_alias: input.destination, amount: input.amountMinor },
    );
    return {
      providerRef: input.idempotencyKey,
      status: res.response_code === "00" ? "succeeded" : "failed",
    };
  }

  private configured(): boolean {
    return Boolean(
      process.env.PAYDUNYA_MASTER_KEY &&
        process.env.PAYDUNYA_PRIVATE_KEY &&
        process.env.PAYDUNYA_TOKEN,
    );
  }

  private verifyHash(received: string): boolean {
    const master = process.env.PAYDUNYA_MASTER_KEY ?? "";
    const expected = Buffer.from(createHash("sha512").update(master).digest("hex"), "utf8");
    const provided = Buffer.from(received, "utf8");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.configured()) {
      throw new ServiceUnavailableException("Clés PayDunya absentes");
    }
    const base = process.env.PAYDUNYA_MODE === "live" ? LIVE_BASE : TEST_BASE;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY ?? "",
        "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY ?? "",
        "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN ?? "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`PayDunya ${path}: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
