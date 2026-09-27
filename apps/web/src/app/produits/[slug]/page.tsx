import { notFound } from "next/navigation";
import { formatMoney } from "@extropolis/shared";
import { api } from "@/lib/api";
import { CheckoutForm } from "@/components/checkout-form";

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await api.product(params.slug).catch(() => null);
  if (!product) {
    notFound();
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div>
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        {product.description && <p className="mt-2 text-stone-600">{product.description}</p>}
        <ul className="mt-4 space-y-2 text-sm">
          {product.variants.map((variant) => (
            <li key={variant.id} className="flex justify-between border-b border-stone-200 py-2">
              <span>{variant.title}</span>
              <span className="font-medium">
                {formatMoney({ amountMinor: variant.priceMinor, currency: variant.currency })}
                {variant.stock === 0 && " — épuisé"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <CheckoutForm variants={product.variants} />
    </div>
  );
}
