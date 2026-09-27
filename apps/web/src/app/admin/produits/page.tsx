import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";

export default async function AdminProductsPage() {
  const products = await api.adminProducts();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Produits</h1>
      <ul className="space-y-3">
        {products.map((product) => (
          <li key={product.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="font-medium">{product.title}</h2>
            <ul className="mt-2 text-sm text-stone-600">
              {product.variants.map((variant) => (
                <li key={variant.id} className="flex justify-between py-1">
                  <span>
                    {variant.title} · {variant.sku}
                  </span>
                  <span>
                    {formatMoney({ amountMinor: variant.priceMinor, currency: variant.currency })} ·
                    stock {variant.stock}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {products.length === 0 && <li className="text-stone-500">Aucun produit.</li>}
      </ul>
    </div>
  );
}
