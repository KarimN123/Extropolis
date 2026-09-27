import { BadRequestException, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { runWithTenant } from "../prisma/tenant-context";
import { TenantResolverService } from "./tenant-resolver.service";

/**
 * En développement, `x-extropolis-tenant` permet de cibler une boutique sans
 * configurer de DNS local. L'en-tête est ignoré hors développement : en
 * production, seul le `Host` fait foi.
 */
const DEV_TENANT_HEADER = "x-extropolis-tenant";

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantResolverService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const host = req.headers.host;
    if (!host) {
      throw new BadRequestException("En-tête Host manquant");
    }

    const devSlug =
      process.env.NODE_ENV !== "production" ? req.headers[DEV_TENANT_HEADER] : undefined;
    const lookupHost =
      typeof devSlug === "string" && devSlug.length > 0
        ? `${devSlug}.${(process.env.PLATFORM_DOMAIN ?? "localhost:3000").split(":")[0]}`
        : host;

    const tenantId = await this.resolver.resolve(lookupHost);
    res.setHeader("x-extropolis-tenant-resolved", tenantId);
    runWithTenant({ tenantId, hostname: lookupHost }, () => next());
  }
}
