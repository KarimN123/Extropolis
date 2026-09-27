import type { CurrencyCode } from "./money";

export type PaymentProviderId = "stripe" | "sandbox" | "paydunya";

export type PaymentRail = "international" | "local";

export type PaymentMethodKind =
  | "card"
  | "wave"
  | "orange_money"
  | "free_money"
  | "moov_money";

export const LOCAL_METHODS: PaymentMethodKind[] = [
  "wave",
  "orange_money",
  "free_money",
  "moov_money",
];

/** Statuts internes, indépendants du vocabulaire de chaque passerelle. */
export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded";

export type NormalizedEventType =
  | "payment.pending"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.cancelled"
  | "payment.refunded";

export interface NormalizedEvent {
  /** Identifiant de l'événement chez la passerelle : garantit l'idempotence. */
  providerEventId: string;
  providerRef: string;
  type: NormalizedEventType;
  amountMinor?: number;
  currency?: CurrencyCode;
  occurredAt: Date;
  raw: unknown;
}

export interface PaymentContext {
  currency: CurrencyCode;
  countryCode?: string;
  method?: PaymentMethodKind;
}

export interface CreateCheckoutInput {
  tenantId: string;
  orderId: string;
  /** Clé d'idempotence fonctionnelle: `${orderId}:${attempt}`. */
  idempotencyKey: string;
  amountMinor: number;
  currency: CurrencyCode;
  method?: PaymentMethodKind;
  customerEmail?: string;
  /** E.164. Identité principale du client sur le rail mobile money. */
  customerPhone?: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  providerRef: string;
  status: PaymentStatus;
  /** Redirection ou deep link vers l'app mobile money. */
  redirectUrl?: string;
  /** Paiement carte confirmé côté client (Stripe Elements). */
  clientSecret?: string;
}

export interface RefundResult {
  providerRef: string;
  status: "succeeded" | "pending" | "pending_manual";
}

export interface PayoutInput {
  tenantId: string;
  amountMinor: number;
  currency: CurrencyCode;
  /** Numéro de wallet (E.164) pour Wave / Orange Money. */
  destination: string;
  method: PaymentMethodKind;
  idempotencyKey: string;
}

export interface PayoutResult {
  providerRef: string;
  status: "pending" | "succeeded" | "failed";
}

export function railFor(currency: CurrencyCode): PaymentRail {
  return currency === "XOF" ? "local" : "international";
}
