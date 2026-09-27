import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  hostname?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenant(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error("Aucun tenant dans le contexte de la requête");
  }
  return ctx;
}
