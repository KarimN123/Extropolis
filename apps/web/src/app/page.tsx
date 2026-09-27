import Link from "next/link";
import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";

export default async function StorefrontPage() {
  const products = await api.products();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalogue</h1>
        <p className="text-sm text-stone-600">
          Paiement par Wave, Orange Money ou carte bancaire.
        </p>
      </div>

      {products.length === 0 ? (
        <p className="text-stone-600">Aucun produit publié pour le moment.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const cheapest = product.variants.reduce(
              (min, variant) => Math.min(min, variant.priceMinor),
              Number.POSITIVE_INFINITY,
            );
            return (
              <li
                key={product.id}
                className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
              >
                <h2 className="font-medium">{product.title}</h2>
                <p className="mt-1 text-sm text-stone-600">
                  À partir de{" "}
                  {formatMoney({
                    amountMinor: cheapest,
                    currency: product.variants[0]?.currency ?? "XOF",
                  })}
                </p>
                <Link
                  href={`/produits/${product.slug}`}
                  className="mt-3 inline-block rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Voir le produit
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
