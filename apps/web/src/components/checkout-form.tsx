"use client";

import { useState, useTransition } from "react";
import type { PaymentMethodKind } from "@extropolis/shared";
import { startCheckoutAction } from "@/app/actions";
import type { Variant } from "@/lib/api";

const METHODS: { id: PaymentMethodKind; label: string; hint: string }[] = [
  { id: "wave", label: "Wave", hint: "Validation dans l'application Wave" },
  { id: "orange_money", label: "Orange Money", hint: "Code de confirmation par USSD" },
  { id: "card", label: "Carte bancaire", hint: "Visa / Mastercard, paiement international" },
];

export function CheckoutForm({ variants }: { variants: Variant[] }) {
  const available = variants.filter((variant) => variant.stock > 0);
  const [variantId, setVariantId] = useState(available[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<PaymentMethodKind>("wave");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (available.length === 0) {
    return (
      <p className="rounded-lg border border-stone-200 bg-white p-4 text-stone-600">
        Produit indisponible.
      </p>
    );
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-stone-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const { redirectUrl } = await startCheckoutAction({
              variantId,
              quantity,
              phone,
              method,
            });
            window.location.href = redirectUrl;
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Paiement indisponible");
          }
        });
      }}
    >
      <h2 className="font-medium">Commander</h2>

      <label className="block text-sm">
        Variante
        <select
          className="mt-1 w-full rounded border border-stone-300 p-2"
          value={variantId}
          onChange={(event) => setVariantId(event.target.value)}
        >
          {available.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.title}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Quantité
        <input
          type="number"
          min={1}
          className="mt-1 w-full rounded border border-stone-300 p-2"
          value={quantity}
          onChange={(event) => setQuantity(Number.parseInt(event.target.value, 10) || 1)}
        />
      </label>

      <label className="block text-sm">
        Téléphone (format international)
        <input
          required
          placeholder="+221770000000"
          className="mt-1 w-full rounded border border-stone-300 p-2"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm">Moyen de paiement</legend>
        {METHODS.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2 rounded border border-stone-200 p-2 text-sm"
          >
            <input
              type="radio"
              name="method"
              className="mt-1"
              checked={method === option.id}
              onChange={() => setMethod(option.id)}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-stone-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Redirection…" : "Payer"}
      </button>
    </form>
  );
}
