import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CatalogService, type CreateProductInput } from "./catalog.service";

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
  list() {
    return this.catalog.listPublic();
  }

  @Get("products/:slug")
  get(@Param("slug") slug: string) {
    return this.catalog.getBySlug(slug);
  }

  @Get("admin/products")
  listAdmin() {
    return this.catalog.listAll();
  }

  @Post("admin/products")
  create(@Body() body: CreateProductInput) {
    return this.catalog.create(body);
  }
}
