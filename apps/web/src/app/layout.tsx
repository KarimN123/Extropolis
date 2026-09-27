import type { Metadata } from "next";
import Link from "next/link";
import { currentTenantSlug } from "@/lib/api";
import "./globals.css";

export const metadata: Metadata = {
  title: "Extropolis",
  description: "Boutiques en ligne africaines : paiement carte et mobile money",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const slug = currentTenantSlug();
  return (
    <html lang="fr">
      <body>
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold capitalize">
              {slug.replace("-", " ")}
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-brand-600">
                Boutique
              </Link>
              <Link href="/admin" className="hover:text-brand-600">
                Espace marchand
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
