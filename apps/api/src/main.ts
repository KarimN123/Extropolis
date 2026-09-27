import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Les webhooks ont besoin du corps brut pour la vérification de signature :
  // ils sont montés avant les parsers JSON/urlencoded.
  app.use("/payments/webhooks", express.raw({ type: "*/*" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number.parseInt(process.env.API_PORT ?? "4000", 10);
  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(`API à l'écoute sur le port ${port}`);
}

void bootstrap();
