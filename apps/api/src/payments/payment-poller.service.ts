import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PaymentsService } from "./payments.service";

@Injectable()
export class PaymentPollerService {
  private readonly logger = new Logger(PaymentPollerService.name);

  constructor(private readonly payments: PaymentsService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async pollPending(): Promise<void> {
    const settled = await this.payments.pollPending();
    if (settled > 0) {
      this.logger.log(`${settled} paiement(s) réglé(s) par vérification serveur`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async reconcileDaily(): Promise<void> {
    const since = new Date(Date.now() - 48 * 3600_000);
    const { checked, mismatches } = await this.payments.reconcile(since);
    this.logger.log(`Réconciliation: ${checked} paiements, ${mismatches.length} écart(s)`);
    for (const mismatch of mismatches) {
      this.logger.warn(`Écart de réconciliation ${mismatch}`);
    }
  }
}
