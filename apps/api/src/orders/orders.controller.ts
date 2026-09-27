import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { OrdersService, type CreateOrderInput } from "./orders.service";

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("orders")
  create(@Body() body: CreateOrderInput) {
    return this.orders.create(body);
  }

  @Get("orders/:id")
  get(@Param("id") id: string) {
    return this.orders.get(id);
  }

  @Get("admin/orders")
  list() {
    return this.orders.list();
  }
}
