"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { PaymentMethodKind } from "@extropolis/shared";
import { api } from "@/lib/api";

function origin(): string {
  const host = headers().get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

/**
 * Crée la commande puis démarre le paiement. Le montant n'est jamais envoyé
 * par le navigateur : l'API le recalcule à partir du catalogue.
 */
export async function startCheckoutAction(input: {
  variantId: string;
  quantity: number;
  phone: string;
  email?: string;
  method: PaymentMethodKind;
}): Promise<{ redirectUrl: string }> {
  const order = await api.createOrder({
    items: [{ variantId: input.variantId, quantity: input.quantity }],
    customer: { phone: input.phone, email: input.email },
  });

  const statusUrl = `${origin()}/commande/${order.id}`;
  const checkout = await api.startCheckout({
    orderId: order.id,
    method: input.method,
    returnUrl: statusUrl,
    cancelUrl: statusUrl,
  });

  return { redirectUrl: checkout.redirectUrl ?? statusUrl };
}

export async function requestPayoutAction(amountMinor: number): Promise<void> {
  await api.requestPayout(amountMinor);
  revalidatePath("/admin/reversements");
}
