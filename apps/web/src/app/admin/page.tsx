import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  awaiting_payment: "En attente de paiement",
  paid: "Payée",
  expired: "Expirée",
  cancelled: "Annulée",
  fulfilled: "Expédiée",
  refunded: "Remboursée",
};

export default async function AdminOrdersPage() {
  const orders = await api.adminOrders();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Commandes</h1>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-100 text-stone-600">
            <tr>
              <th className="p-3">Numéro</th>
              <th className="p-3">Statut</th>
              <th className="p-3">Montant</th>
              <th className="p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-stone-200">
                <td className="p-3 font-mono text-xs">{order.number}</td>
                <td className="p-3">{STATUS_LABELS[order.status] ?? order.status}</td>
                <td className="p-3">
                  {formatMoney({ amountMinor: order.totalMinor, currency: order.currency })}
                </td>
                <td className="p-3 text-stone-500">
                  {new Date(order.createdAt).toLocaleString("fr-FR")}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td className="p-3 text-stone-500" colSpan={4}>
                  Aucune commande.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
