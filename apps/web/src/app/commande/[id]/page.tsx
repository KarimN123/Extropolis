import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";

const LABELS: Record<string, { title: string; detail: string }> = {
  paid: {
    title: "Paiement confirmé",
    detail: "Le marchand a reçu la confirmation et prépare votre commande.",
  },
  awaiting_payment: {
    title: "Paiement en cours de vérification",
    detail:
      "Le retour de votre application mobile money ne vaut pas confirmation : la boutique attend la validation de l'opérateur. Cette page se met à jour automatiquement.",
  },
  refunded: { title: "Commande remboursée", detail: "Le remboursement a été enregistré." },
};

export default async function OrderStatusPage({ params }: { params: { id: string } }) {
  const order = await api.order(params.id);
  const label = LABELS[order.status] ?? {
    title: `Statut : ${order.status}`,
    detail: "Aucune action n'est requise de votre part.",
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Le statut vient toujours du serveur, jamais du retour navigateur. */}
      {order.status === "awaiting_payment" && <meta httpEquiv="refresh" content="5" />}
      <h1 className="text-2xl font-semibold">{label.title}</h1>
      <p className="text-stone-600">{label.detail}</p>
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-sm text-stone-500">Commande {order.number}</p>
        <p className="text-lg font-medium">
          {formatMoney({ amountMinor: order.totalMinor, currency: order.currency })}
        </p>
        <ul className="mt-3 space-y-1 text-sm text-stone-600">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.quantity} × {item.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
