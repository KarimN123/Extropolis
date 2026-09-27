export type CurrencyCode = "XOF" | "EUR" | "USD";

/**
 * Nombre de décimales de la devise. Le franc CFA n'a pas de sous-unité :
 * 1000 XOF se stocke `1000`, alors que 10,00 EUR se stocke `1000`.
 */
export const CURRENCY_MINOR_UNITS: Record<CurrencyCode, number> = {
  XOF: 0,
  EUR: 2,
  USD: 2,
};

export const LOCAL_CURRENCY: CurrencyCode = "XOF";

/** Tous les montants circulent en unités mineures entières, jamais en flottant. */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Montant non entier: ${amountMinor}`);
  }
  return { amountMinor, currency };
}

export function formatMoney(value: Money, locale = "fr-FR"): string {
  const minorUnits = CURRENCY_MINOR_UNITS[value.currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(value.amountMinor / 10 ** minorUnits);
}

/** Répartit un montant en parts entières sans perdre ni créer d'unité mineure. */
export function splitMinor(amountMinor: number, bps: number): { fee: number; net: number } {
  if (bps < 0 || bps > 10_000) {
    throw new Error(`Taux hors bornes: ${bps} bps`);
  }
  const fee = Math.round((amountMinor * bps) / 10_000);
  return { fee, net: amountMinor - fee };
}
