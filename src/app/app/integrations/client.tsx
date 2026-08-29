"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, HudLabel, Input } from "@/components/ui";
import { mapProperty, unmapProperty } from "@/lib/integrations/property-actions";
import { FORMA_ESPERADA } from "@/lib/integrations/google/mapping";
import type { AgencyTokenState, IntegrationReason, SurfaceView } from "@/lib/integrations/google/screen";
import type { GoogleSurface } from "@/lib/integrations/google/sources";

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
  expired: { label: "EXPIRED", variant: "orange" },
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
  "platform-token-expired":
    "The agency's Google token expired. Fixed once, by refreshing it — not per client, and the mapping below is unaffected.",
  "agency-organization-undecided":
    "No column says which organization is the agency, so the token cannot be looked up. This is a product decision, not a setting on this screen. See ESPINA_VULKAN.md, «El modelo de acceso a Google».",
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
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  surfaces: SurfaceView[];
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
          <SurfaceRow key={view.surface} organizationId={organizationId} view={view} />
        ))}
      </div>
    </Card>
  );
}

function SurfaceRow({
  organizationId,
  view,
}: {
  organizationId: string;
  view: SurfaceView;
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
