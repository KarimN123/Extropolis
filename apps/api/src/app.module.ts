import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { CatalogModule } from "./catalog/catalog.module";
import { HealthController } from "./health.controller";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { TenantMiddleware } from "./tenancy/tenant.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TenancyModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    PayoutsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  /**
   * Le middleware de tenant couvre tout sauf les routes hors boutique :
   * les webhooks (authentifiés par signature, tenant déduit du paiement),
   * le simulateur PSP et la sonde de santé.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude("payments/webhooks/(.*)", "sandbox/(.*)", "healthz")
      .forRoutes("*");
  }
}
