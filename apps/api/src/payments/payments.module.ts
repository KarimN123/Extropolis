import { Module } from "@nestjs/common";
import { LedgerService } from "../ledger/ledger.service";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider";
import { PaymentRouterService } from "./payment-router.service";
import { PaymentPollerService } from "./payment-poller.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { SandboxController } from "./sandbox.controller";
import { PaydunyaProvider } from "./providers/paydunya.provider";
import { SandboxLocalProvider } from "./providers/sandbox-local.provider";
import { StripeProvider } from "./providers/stripe.provider";

@Module({
  controllers: [PaymentsController, SandboxController],
  providers: [
    StripeProvider,
    SandboxLocalProvider,
    PaydunyaProvider,
    {
      provide: PAYMENT_PROVIDERS,
      // Ordre = priorité de routage. Le rail local passe avant Stripe en XOF,
      // et `supports()` écarte de toute façon les passerelles hors périmètre.
      inject: [StripeProvider, SandboxLocalProvider, PaydunyaProvider],
      useFactory: (
        stripe: StripeProvider,
        sandbox: SandboxLocalProvider,
        paydunya: PaydunyaProvider,
      ): PaymentProvider[] =>
        process.env.LOCAL_PSP_PROVIDER === "paydunya"
          ? [paydunya, sandbox, stripe]
          : [sandbox, paydunya, stripe],
    },
    PaymentRouterService,
    PaymentsService,
    PaymentPollerService,
    LedgerService,
  ],
  exports: [PaymentsService, PaymentRouterService, LedgerService],
})
export class PaymentsModule {}
