import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Commandes" },
  { href: "/admin/produits", label: "Produits" },
  { href: "/admin/reversements", label: "Reversements" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b border-stone-200 pb-2 text-sm">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="hover:text-brand-600">
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
