import { Body, Controller, Headers, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { PaymentMethodKind } from "@extropolis/shared";
import { PaymentsService } from "./payments.service";

interface StartCheckoutBody {
  orderId: string;
  method?: PaymentMethodKind;
  returnUrl: string;
  cancelUrl: string;
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("payments/checkout")
  async startCheckout(@Body() body: StartCheckoutBody) {
    const { checkout, paymentIntentId } = await this.payments.startCheckout(body.orderId, {
      method: body.method,
      returnUrl: body.returnUrl,
      cancelUrl: body.cancelUrl,
    });
    return { paymentIntentId, ...checkout };
  }

  @Post("payments/:id/refund")
  async refund(@Param("id") id: string, @Body() body: { amountMinor?: number }) {
    return this.payments.refund(id, body.amountMinor);
  }

  /**
   * Les webhooks sont hors tenant : la signature authentifie l'appelant et le
   * `providerRef` désigne la boutique. Réponse immédiate, aucun traitement long.
   */
  @Post("payments/webhooks/:provider")
  @HttpCode(200)
  async webhook(
    @Param("provider") provider: string,
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    return this.payments.ingestWebhook(provider, { body, headers });
  }
}
