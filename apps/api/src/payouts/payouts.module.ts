import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module";
import { PayoutsController } from "./payouts.controller";
import { PayoutsService } from "./payouts.service";

@Module({
  imports: [PaymentsModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
})
export class PayoutsModule {}
