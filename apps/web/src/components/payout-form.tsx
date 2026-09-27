"use client";

import { useState, useTransition } from "react";
import { requestPayoutAction } from "@/app/actions";

export function PayoutForm({ availableMinor }: { availableMinor: number }) {
  const [amount, setAmount] = useState(availableMinor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            await requestPayoutAction(amount);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Reversement impossible");
          }
        });
      }}
    >
      <label className="text-sm">
        Montant à reverser (XOF)
        <input
          type="number"
          min={1}
          max={availableMinor}
          className="mt-1 block w-48 rounded border border-stone-300 p-2"
          value={amount}
          onChange={(event) => setAmount(Number.parseInt(event.target.value, 10) || 0)}
        />
      </label>
      <button
        type="submit"
        disabled={pending || availableMinor <= 0}
        className="rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Envoi…" : "Demander le reversement"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
