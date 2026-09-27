import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { requireTenant } from "./tenant-context";

export type TenantClient = Omit<PrismaClient, ITXClientDenyList>;
type ITXClientDenyList = "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends";

/**
 * Accès à la base sous Row Level Security.
 *
 * Toute lecture ou écriture métier passe par `withTenant`, qui ouvre une
 * transaction et y positionne `app.tenant_id`. La valeur vient exclusivement du
 * contexte de requête résolu à partir du `Host`, jamais d'un paramètre client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.$disconnect(), this.platform.$disconnect()]);
  }

  /** Exécute `fn` dans une transaction dont le tenant courant est celui du contexte. */
  async withTenant<T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> {
    return this.withTenantId(requireTenant().tenantId, fn);
  }

  async withTenantId<T>(tenantId: string, fn: (tx: TenantClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.tenant_id', ${tenantId}::text, true)`;
      return fn(tx);
    });
  }

  /**
   * Accès sans filtre de tenant, réservé à la console plateforme et aux
   * traitements système (webhooks, réconciliation, payouts). Utilise une
   * connexion distincte sous le rôle propriétaire, non soumis au RLS : le rôle
   * applicatif ne peut donc jamais s'en affranchir, même via une requête forgée.
   * Chaque usage doit être tracé dans `audit_log`.
   */
  async asPlatform<T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> {
    return this.platform.$transaction((tx) => fn(tx));
  }

  private readonly platform = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  static isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
