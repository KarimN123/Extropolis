import type {
  CheckoutResult,
  CreateCheckoutInput,
  NormalizedEvent,
  PaymentContext,
  PaymentProviderId,
  PaymentStatus,
  PayoutInput,
  PayoutResult,
  RefundResult,
} from "@extropolis/shared";

export interface RawWebhook {
  /** Corps brut : la signature se vérifie avant tout parsing JSON. */
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Contrat unique des passerelles. Aucun module métier n'importe le SDK Stripe
 * ni le client PSP : ajouter Wave en direct revient à ajouter un adaptateur.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;
  supports(ctx: PaymentContext): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;
  /** Vérification serveur-à-serveur, utilisée par le polling et la réconciliation. */
  verify(providerRef: string): Promise<PaymentStatus>;
  parseWebhook(raw: RawWebhook): Promise<NormalizedEvent>;
  refund(providerRef: string, amountMinor: number): Promise<RefundResult>;
  payout?(input: PayoutInput): Promise<PayoutResult>;
}

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");
