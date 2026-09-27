import { Body, Controller, Get, Post } from "@nestjs/common";
import type { CurrencyCode } from "@extropolis/shared";
import { PayoutsService } from "./payouts.service";

@Controller("admin/payouts")
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get("balance")
  balance() {
    return this.payouts.balance();
  }

  @Get()
  list() {
    return this.payouts.list();
  }

  @Post()
  request(@Body() body: { amountMinor: number; currency?: CurrencyCode }) {
    return this.payouts.request(body);
  }
}
