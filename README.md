# Extropolis

Plateforme e-commerce multi-tenant pour marchands africains : chaque marchand a sa
boutique, son catalogue et ses commandes, avec deux rails de paiement — carte
internationale (Stripe) et mobile money local (Wave, Orange Money, Free Money,
Moov via PSP).

## Modèle de flux de fonds

La plateforme encaisse, puis reverse :

1. le client paie (Stripe ou PSP local) ;
2. les fonds arrivent sur les comptes de la plateforme ;
3. le grand livre inscrit la vente et la commission (`PLATFORM_FEE_BPS`) ;
4. le marchand demande un reversement vers son wallet Wave / Orange Money.

Le solde d'un marchand n'est jamais une colonne : c'est toujours la somme de ses
écritures (`ledger_entries`, append-only — `UPDATE`/`DELETE` révoqués pour le
rôle applicatif).

> Encaisser pour le compte de tiers puis reverser fait de l'exploitant un
> intermédiaire de paiement. À valider avec un conseil juridique et le PSP local.

## Architecture

```
apps/api      NestJS + Prisma : tenancy, catalogue, commandes, paiements, payouts
apps/web      Next.js (App Router) + Tailwind : vitrine et espace marchand
packages/shared  Types monnaie et contrats de paiement partagés
```

### Multi-tenant

- Tables partagées avec `tenantId`, isolées par **Row Level Security**.
- Le tenant est résolu à partir du `Host` (`mamalys.localhost`), jamais d'un
  paramètre envoyé par le client ; en développement, l'en-tête
  `x-extropolis-tenant` permet de simuler un domaine.
- L'application se connecte avec `APP_DATABASE_URL` (rôle `extropolis_app`, non
  propriétaire, sans BYPASSRLS). Les traitements système (webhooks,
  réconciliation, reversements) utilisent `DATABASE_URL` via `asPlatform()`.

### Paiements

Chaque passerelle implémente la même interface (`PaymentProvider`) :
`createCheckout`, `verify`, `parseWebhook`, `refund`, `payout`.

| Provider   | Devises | Méthodes                        | Usage                   |
| ---------- | ------- | ------------------------------- | ----------------------- |
| `stripe`   | EUR/USD | carte                           | rail international      |
| `paydunya` | XOF     | Wave, OM, Free Money, Moov      | rail local production   |
| `sandbox`  | XOF     | idem, simulé en mémoire         | développement et tests  |

Règles appliquées :

- une commande ne passe **jamais** à `paid` sur un retour navigateur ; seul un
  événement serveur (webhook vérifié ou `verify()`) la valide ;
- les webhooks sont idempotents par `(provider, providerEventId)` et vérifiés
  sur le corps brut (signature Stripe, hash PayDunya, HMAC sandbox) ;
- un webhook mobile money peut ne jamais arriver : un polling à intervalles
  croissants (10 s → 15 min) et une réconciliation quotidienne rattrapent
  l'écart entre la passerelle et la base ;
- les montants sont des entiers en unités mineures, le XOF n'ayant pas de
  décimale.

## Démarrage

```bash
cp .env.example .env && cp .env.example apps/api/.env
pnpm install
pnpm db:up          # PostgreSQL 16 + Redis 7
pnpm db:migrate
pnpm db:seed        # 2 boutiques de démonstration
pnpm dev            # API :4000 — web :3000
```

Boutiques de démonstration : http://mamalys.localhost:3000 et
http://teranga-tech.localhost:3000 (les sous-domaines `.localhost` se résolvent
sans configuration sur la plupart des systèmes).

Le simulateur de PSP (`/sandbox/psp/:ref`) reproduit le parcours mobile money,
y compris le cas « paiement encaissé, webhook perdu » que seul le polling
rattrape.

## Vérifications

```bash
pnpm lint
pnpm typecheck
pnpm test        # isolation RLS, parcours de paiement, arithmétique monétaire
pnpm build
```

Les tests d'isolation interrogent la base **sans aucun filtre applicatif** : ce
qui les fait passer, c'est le RLS.

## Reste à faire avant la production

- Authentification et rôles (owner/admin/staff) — non implémentés.
- Clés PSP par marchand (`tenant_payment_configs.credentialsEncrypted`).
- Chemin `checkout-invoice/confirm/{token}` de PayDunya à confirmer avec des
  clés sandbox réelles.
- Files BullMQ pour le polling et les webhooks (aujourd'hui `@nestjs/schedule`
  en process, suffisant pour une instance unique).
