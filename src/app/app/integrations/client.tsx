"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, HudLabel, Input } from "@/components/ui";
import { mapProperty, unmapProperty } from "@/lib/integrations/property-actions";
import { FORMA_ESPERADA } from "@/lib/integrations/google/mapping";
import type { AgencyTokenState, IntegrationReason, SurfaceView } from "@/lib/integrations/google/screen";
import type { GoogleSurface } from "@/lib/integrations/google/sources";
import { type SondaVista, haceCuanto, queHacer } from "@/lib/integrations/google/probeView";

/**
 * Cómo se llama cada superficie para quien la opera. `provider` es el
 * vocabulario de la `0017` y no se muestra: nadie fuera del repositorio sabe qué
 * es `google_business_profile`.
 */
const NOMBRE: Record<GoogleSurface, string> = {
  search_console: "Search Console",
  ga4: "Google Analytics 4",
  google_business_profile: "Google Business Profile",
};

/** Las cuatro palabras, y el tono con que se ven. */
const ESTADO: Record<
  SurfaceView["state"],
  { label: string; variant: "success" | "orange" | "critical" | "hud" }
> = {
  connected: { label: "CONNECTED", variant: "success" },
  "not-connected": { label: "NOT CONNECTED", variant: "hud" },
  error: { label: "ERROR", variant: "critical" },
};

/**
 * DÓNDE SE ARREGLA CADA UNA. Es la razón por la que esta pantalla existe.
 *
 * Las dos primeras comparten estado en el reporte —las dos son `missing`— y se
 * arreglan en lugares distintos: una en Google Cloud, una vez, por quien opera
 * la plataforma; la otra acá abajo, por cliente. Mostrarlas iguales manda a un
 * operador a configurar un cliente que ya está bien.
 */
const RAZON: Record<IntegrationReason, string> = {
  "platform-not-connected":
    "The platform has no Google credentials. Fixed once, in Google Cloud — not per client. Nothing below will work until then.",
  "client-not-mapped":
    "The platform is connected; this client has no property assigned. Fixed here, for this client.",
  "platform-token-revoked":
    "The agency's Google authorization was revoked. Fixed once, by redoing the OAuth consent — not per client.",
  "platform-token-absent":
    "The agency organization is identified and has no Google token yet. Fixed once, by running the OAuth consent — not per client.",
  "agency-organization-unset":
    "VULKAN_AGENCY_ORG_ID is not set, so the agency's token cannot be looked up. The token may well be fine; this is a server setting, not something on this screen.",
  "agency-organization-malformed":
    "VULKAN_AGENCY_ORG_ID is set to something that is not a UUID, so it matches no organization. Fix the value — reconnecting Google will not help.",
  "agency-token-unreadable":
    "The agency's token state could not be read. This says nothing about the token, which may be active: it is the lookup that failed.",
};

export function PlatformNotice({
  connected,
  tokenState,
}: {
  connected: boolean;
  tokenState: AgencyTokenState;
}) {
  return (
    <Card className="mt-6">
      <HudLabel>PLATFORM · ONE FOR EVERY CLIENT</HudLabel>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
            GOOGLE OAUTH CREDENTIALS
          </span>
          <Badge variant={connected ? "success" : "hud"}>
            {connected ? "PRESENT" : "NOT CONFIGURED"}
          </Badge>
        </div>
        <div className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
            AGENCY TOKEN
          </span>
          <Badge variant={tokenState === "active" ? "success" : "hud"}>
            {tokenState.toUpperCase()}
          </Badge>
        </div>
      </div>
      {/*
        El enlace aparece SÓLO cuando hay algo que conectar y con qué conectarlo.
        Sin credenciales de plataforma el consentimiento no puede ni empezar, y el
        enlace mandaría a un operador a chocarse con un 503; con el token `active`,
        ofrecer «conectar» invita a rehacer un OAuth que está hecho — y rehacerlo
        REVOCA el vivo antes de escribir el nuevo, así que un clic de curiosidad
        deja a la plataforma sin token si el consentimiento se abandona a la mitad.

        Los DOS estados que sí lo muestran se arreglan con el mismo acto. Los
        cinco que no —`active`, `expired` y las tres maneras de no saber— no:
        `unset`, `malformed` y `unreadable` no dicen nada del token, y ofrecer
        reconectar ahí es exactamente el defecto que `agency.ts` existe para
        impedir.

        `expired` estaba en la lista de los que lo muestran, y era el mismo
        defecto que el párrafo de arriba describe para `active`. Un token
        vencido NO está desconectado: `tokenStore.ts` trata `expired` como un
        camino normal y canjea el refresh solo. Medido en producción el
        2026-09-05, con el estado en `expired`: Search Console contestó `ok` y
        PageSpeed contestó `ok` en la misma corrida, y el reporte salió con
        datos reales del cliente —13 clics y posición media 32.9—.

        O sea que la pantalla ofrecía reconectar sobre un token VIVO, y
        reconectar revoca el vivo antes de escribir el nuevo. Seguir el consejo
        de la pantalla rompía lo que estaba funcionando.

        Si de verdad falla algo, el motivo está por fuente en
        `integration_probe`, que es evidencia medida y no una marca de tiempo.
      */}
      {connected && (tokenState === "absent" || tokenState === "revoked") && (
          <a
            href="/api/auth/google/start"
            className="mt-4 inline-block rounded-vulkan border border-vulkan-orange bg-metal-950 px-4 py-2 font-display text-[12px] uppercase tracking-hud text-vulkan-orange"
          >
            {tokenState === "absent" ? "CONNECT GOOGLE" : "RECONNECT GOOGLE"}
          </a>
        )}

      <p className="mt-4 text-[12px] text-metal-400">
        Access to Google is delegated: one OAuth token, held by the Vulkan account, with permission
        over every client&apos;s properties. Nothing here is per client — the per-client half is the
        mapping below, and that is the only thing that keeps one client&apos;s numbers out of
        another&apos;s report.
      </p>
    </Card>
  );
}

export function OrganizationIntegrations({
  organizationId,
  organizationName,
  organizationSlug,
  surfaces,
  probes = [],
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  surfaces: SurfaceView[];
  /** La última respuesta de Google por superficie. Vacío cuando nadie consultó todavía. */
  probes?: SondaVista[];
}) {
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <HudLabel>{organizationName.toUpperCase()}</HudLabel>
        <span className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
          {organizationSlug}
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {surfaces.map((view) => (
          <SurfaceRow
            key={view.surface}
            organizationId={organizationId}
            view={view}
            probe={probes.find((p) => p.surface === view.surface)}
          />
        ))}
      </div>
    </Card>
  );
}

function SurfaceRow({
  organizationId,
  view,
  probe,
}: {
  organizationId: string;
  view: SurfaceView;
  probe?: SondaVista;
}) {
  const [valor, setValor] = useState(view.propertyRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const estado = ESTADO[view.state];

  function conectar() {
    setError(null);
    start(async () => {
      const res = await mapProperty({
        organizationId,
        surface: view.surface,
        propertyRef: valor,
      });
      if (!res.ok) setError(res.message);
    });
  }

  function desconectar() {
    setError(null);
    start(async () => {
      const res = await unmapProperty({ organizationId, surface: view.surface });
      if (!res.ok) setError(res.message);
      else setValor("");
    });
  }

  return (
    <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-[13px] uppercase tracking-hud text-vulkan-white">
          {NOMBRE[view.surface]}
        </p>
        <Badge variant={estado.variant}>{estado.label}</Badge>
      </div>

      {view.reason && (
        <p className="mt-2 text-[12px] text-metal-400">{RAZON[view.reason]}</p>
      )}

      {/*
        Lo que Google contestó la última vez. Va DESPUÉS de la razón y no en su
        lugar: la razón dice qué falta configurar, y esto dice qué pasó cuando se
        preguntó. Son dos cosas distintas y las dos pueden ser ciertas a la vez.

        Se muestra sólo cuando hay algo que decir — `queHacer` devuelve null si la
        última consulta salió bien— porque un cartel que aparece siempre se deja
        de leer.
      */}
      {probe && queHacer(probe) && (
        <p className="mt-2 text-[12px] text-vulkan-orange" data-testid={`sonda-${view.surface}`}>
          {queHacer(probe)}{" "}
          <span className="text-metal-500">· medido {haceCuanto(probe.checkedAt)}</span>
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={FORMA_ESPERADA[view.surface]}
          aria-label={`${NOMBRE[view.surface]} property`}
          className="flex-1"
        />
        <Button onClick={conectar} disabled={pending} variant="primary">
          {view.propertyRef ? "REMAP" : "CONNECT"}
        </Button>
        <Button
          onClick={desconectar}
          disabled={pending || !view.propertyRef}
          variant="secondary"
        >
          DISCONNECT
        </Button>
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-metal-500">
        EXPECTED · {FORMA_ESPERADA[view.surface]}
      </p>

      {error && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-red-400">{error}</p>
      )}
    </div>
  );
}
