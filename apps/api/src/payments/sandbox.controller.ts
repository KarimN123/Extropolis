import { Controller, Get, Header, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { SandboxLocalProvider } from "./providers/sandbox-local.provider";
import { PaymentsService } from "./payments.service";

/**
 * Simulateur du parcours mobile money : tient lieu d'application Wave /
 * Orange Money en développement. Le bouton « ne rien renvoyer » reproduit un
 * webhook perdu, que seul le polling rattrape.
 */
@Controller("sandbox/psp")
export class SandboxController {
  constructor(
    private readonly sandbox: SandboxLocalProvider,
    private readonly payments: PaymentsService,
  ) {}

  @Get(":ref")
  @Header("content-type", "text/html; charset=utf-8")
  page(@Param("ref") ref: string): string {
    const charge = this.sandbox.peek(ref);
    if (!charge) {
      return `<h1>Transaction inconnue</h1>`;
    }
    return `<!doctype html><html lang="fr"><meta charset="utf-8">
<title>Paiement mobile money (sandbox)</title>
<body style="font-family:system-ui;max-width:24rem;margin:4rem auto">
  <h1>Paiement mobile money</h1>
  <p>Montant : <strong>${charge.amountMinor} ${charge.currency}</strong></p>
  <p>Numéro : ${charge.phone ?? "non renseigné"}</p>
  <form method="post" action="/sandbox/psp/${ref}/settle?outcome=succeeded">
    <button type="submit">Confirmer le paiement</button>
  </form>
  <form method="post" action="/sandbox/psp/${ref}/settle?outcome=succeeded&amp;notify=0">
    <button type="submit">Confirmer sans webhook (webhook perdu)</button>
  </form>
  <form method="post" action="/sandbox/psp/${ref}/settle?outcome=failed">
    <button type="submit">Refuser</button>
  </form>
</body></html>`;
  }

  @Post(":ref/settle")
  async settle(
    @Param("ref") ref: string,
    @Query("outcome") outcome: "succeeded" | "failed",
    @Query("notify") notify: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const charge = this.sandbox.settle(ref, outcome);
    if (notify !== "0") {
      await this.payments.applyEvent("sandbox", {
        providerEventId: randomUUID(),
        providerRef: ref,
        type: outcome === "succeeded" ? "payment.succeeded" : "payment.failed",
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        occurredAt: new Date(),
        raw: { ref, outcome },
      });
    }
    res.status(200).send(
      `<!doctype html><meta charset="utf-8"><p>Transaction ${outcome}.` +
        (notify === "0" ? " Webhook volontairement non émis." : "") +
        ` Vous pouvez fermer cette page.</p>`,
    );
  }
}
