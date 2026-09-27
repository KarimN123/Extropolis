import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface CacheEntry {
  tenantId: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * Résolution `Host` → `tenant_id`. Sous-domaines `<slug>.<PLATFORM_DOMAIN>` par
 * défaut, domaines personnalisés via la table `domains`.
 */
@Injectable()
export class TenantResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(host: string): Promise<string> {
    const hostname = host.split(":")[0]?.toLowerCase() ?? "";
    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tenantId;
    }

    const tenantId = await this.lookup(hostname);
    if (!tenantId) {
      throw new NotFoundException(`Aucune boutique pour le domaine ${hostname}`);
    }
    this.cache.set(hostname, { tenantId, expiresAt: Date.now() + CACHE_TTL_MS });
    return tenantId;
  }

  invalidate(hostname: string): void {
    this.cache.delete(hostname.toLowerCase());
  }

  private async lookup(hostname: string): Promise<string | null> {
    return this.prisma.asPlatform(async (tx) => {
      const domain = await tx.domain.findUnique({ where: { hostname } });
      if (domain) {
        return domain.tenantId;
      }
      const platformDomain = (process.env.PLATFORM_DOMAIN ?? "localhost:3000").split(":")[0];
      if (platformDomain && hostname.endsWith(`.${platformDomain}`)) {
        const slug = hostname.slice(0, -(platformDomain.length + 1));
        const tenant = await tx.tenant.findUnique({ where: { slug } });
        return tenant?.id ?? null;
      }
      return null;
    });
  }
}
