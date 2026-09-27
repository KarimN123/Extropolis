import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { PaymentContext } from "@extropolis/shared";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider";

/**
 * Sélection du rail. Ordre : méthode explicitement choisie par le client,
 * puis devise, puis pays. En cas d'indisponibilité, `fallbacks` fournit les
 * passerelles de repli plutôt que d'échouer le checkout.
 */
@Injectable()
export class PaymentRouterService {
  private readonly logger = new Logger(PaymentRouterService.name);

  constructor(@Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[]) {}

  candidates(ctx: PaymentContext): PaymentProvider[] {
    return this.providers.filter((provider) => provider.supports(ctx));
  }

  select(ctx: PaymentContext): PaymentProvider {
    const [provider] = this.candidates(ctx);
    if (!provider) {
      this.logger.warn(`Aucune passerelle pour ${ctx.currency} / ${ctx.method ?? "auto"}`);
      throw new ServiceUnavailableException(
        `Aucun moyen de paiement disponible pour ${ctx.currency}`,
      );
    }
    return provider;
  }

  byId(id: string): PaymentProvider {
    const provider = this.providers.find((candidate) => candidate.id === id);
    if (!provider) {
      throw new ServiceUnavailableException(`Passerelle inconnue: ${id}`);
    }
    return provider;
  }
}
