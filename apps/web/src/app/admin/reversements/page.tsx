import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";
import { PayoutForm } from "@/components/payout-form";

const STATUS_LABELS: Record<string, string> = {
  requested: "Demandé",
  processing: "En cours",
  paid: "Versé",
  failed: "Échoué",
};

export default async function PayoutsPage() {
  const [balance, payouts] = await Promise.all([api.balance(), api.payouts()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reversements</h1>
        <p className="text-sm text-stone-600">
          Les paiements sont encaissés par la plateforme puis reversés sur votre wallet Wave ou
          Orange Money, commission déduite.
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-sm text-stone-500">Solde disponible</p>
        <p className="text-2xl font-semibold">
          {formatMoney({ amountMinor: balance.availableMinor, currency: balance.currency })}
        </p>
        <PayoutForm availableMinor={balance.availableMinor} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-100 text-stone-600">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Destination</th>
              <th className="p-3">Montant</th>
              <th className="p-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => (
              <tr key={payout.id} className="border-t border-stone-200">
                <td className="p-3 text-stone-500">
                  {new Date(payout.createdAt).toLocaleString("fr-FR")}
                </td>
                <td className="p-3">
                  {payout.method} · {payout.destination}
                </td>
                <td className="p-3">
                  {formatMoney({ amountMinor: payout.amountMinor, currency: payout.currency })}
                </td>
                <td className="p-3">{STATUS_LABELS[payout.status] ?? payout.status}</td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr>
                <td className="p-3 text-stone-500" colSpan={4}>
                  Aucun reversement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
