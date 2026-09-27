import { headers } from "next/headers";
import type { CurrencyCode, PaymentMethodKind } from "@extropolis/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Variant {
  id: string;
  sku: string;
  title: string;
  priceMinor: number;
  currency: CurrencyCode;
  stock: number;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  variants: Variant[];
}

export interface Order {
  id: string;
  number: string;
  status: string;
  currency: CurrencyCode;
  totalMinor: number;
  createdAt: string;
  items: { id: string; title: string; quantity: number; unitPriceMinor: number }[];
}

export interface Payout {
  id: string;
  amountMinor: number;
  currency: CurrencyCode;
  method: string;
  destination: string;
  status: string;
  createdAt: string;
}

/**
 * La boutique est déterminée par le sous-domaine (`mamalys.localhost:3000`).
 * En développement, l'API accepte l'en-tête `x-extropolis-tenant` plutôt que
 * d'exiger un vrai domaine : c'est le seul endroit qui connaît cette
 * correspondance.
 */
export function currentTenantSlug(): string {
  const host = headers().get("host") ?? "";
  const [subdomain] = host.split(":")[0]!.split(".");
  return subdomain && subdomain !== "localhost" && subdomain !== "www"
    ? subdomain
    : (process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? "mamalys");
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-extropolis-tenant": currentTenantSlug(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const api = {
  products: () => apiFetch<Product[]>("/products"),
  product: (slug: string) => apiFetch<Product>(`/products/${slug}`),
  adminOrders: () => apiFetch<Order[]>("/admin/orders"),
  adminProducts: () => apiFetch<Product[]>("/admin/products"),
  balance: () => apiFetch<{ currency: CurrencyCode; availableMinor: number }>("/admin/payouts/balance"),
  payouts: () => apiFetch<Payout[]>("/admin/payouts"),
  requestPayout: (amountMinor: number) =>
    apiFetch<Payout>("/admin/payouts", {
      method: "POST",
      body: JSON.stringify({ amountMinor }),
    }),
  createOrder: (body: {
    items: { variantId: string; quantity: number }[];
    customer?: { phone?: string; email?: string; fullName?: string };
  }) => apiFetch<Order>("/orders", { method: "POST", body: JSON.stringify(body) }),
  order: (id: string) => apiFetch<Order>(`/orders/${id}`),
  startCheckout: (body: {
    orderId: string;
    method: PaymentMethodKind;
    returnUrl: string;
    cancelUrl: string;
  }) =>
    apiFetch<{ paymentIntentId: string; redirectUrl?: string; clientSecret?: string }>(
      "/payments/checkout",
      { method: "POST", body: JSON.stringify(body) },
    ),
};
