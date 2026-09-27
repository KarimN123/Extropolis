import { formatMoney, money, splitMinor } from "@extropolis/shared";

describe("montants", () => {
  it("refuse un montant non entier : jamais de flottant sur de l'argent", () => {
    expect(() => money(12.5, "XOF")).toThrow();
  });

  it("répartit commission et net sans perdre d'unité", () => {
    for (const amount of [1, 7, 999, 45_000, 1_234_567]) {
      const { fee, net } = splitMinor(amount, 250);
      expect(fee + net).toBe(amount);
      expect(Number.isInteger(fee)).toBe(true);
    }
  });

  it("formate le XOF sans décimales et l'EUR avec", () => {
    expect(formatMoney({ amountMinor: 45_000, currency: "XOF" })).toContain("45");
    expect(formatMoney({ amountMinor: 1050, currency: "EUR" })).toContain("10,50");
  });
});
