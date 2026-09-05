"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Card, HudLabel } from "@/components/ui";
import { leerAsset, type AssetVisto, type ClaseDeAsset } from "@/lib/content/estadoDelAsset";

const TONO: Record<ClaseDeAsset, "success" | "hud" | "critical" | "orange"> = {
  aprobado: "success",
  borrador: "hud",
  "sello-viejo": "orange",
  incoherente: "critical",
};

const ETIQUETA: Record<ClaseDeAsset, string> = {
  aprobado: "APPROVED",
  borrador: "DRAFT",
  "sello-viejo": "STALE SEAL",
  incoherente: "BROKEN",
};

export function ContenidoDeLaOrganizacion({
  assets,
  businessId,
}: {
  assets: AssetVisto[];
  businessId: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function aprobar(assetId: string) {
    setError(null);
    const res = await fetch("/api/content/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => ({}))) as { motivo?: string };
      // El motivo se muestra, no se traga: `el-texto-cambio` manda a releer, y
      // cualquier otra cosa manda a mirar la base. Un fallo silencioso acá deja
      // a alguien apretando un botón que no hace nada.
      setError(
        cuerpo.motivo === "el-texto-cambio"
          ? "El texto cambió mientras tanto, así que el sello no se pudo poner. Recargá y volvé a aprobar."
          : `No se pudo aprobar (${res.status}).`
      );
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <>
      {error && (
        <div
          data-testid="error-al-aprobar"
          className="mt-4 rounded-vulkan border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-200"
        >
          {error}
        </div>
      )}

      <Card className="mt-6">
        <HudLabel>CONTENT</HudLabel>
        <p className="mt-3 text-[12px] text-metal-400">
          Aprobar sella el texto TAL COMO ESTÁ. Si después se edita, el sello se borra solo y el
          asset vuelve a borrador — por eso la publicación no puede salir con un texto que nadie
          leyó.
        </p>

        {assets.length === 0 ? (
          <p className="mt-4 text-[12px] text-metal-400" data-testid="sin-contenido">
            {businessId
              ? "Esta organización no tiene contenido todavía."
              : "Esta organización no tiene ningún negocio, así que no hay dónde crear contenido."}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {assets.map((a) => {
              const lectura = leerAsset(a);
              return (
                <div
                  key={a.id}
                  data-testid="asset"
                  data-clase={lectura.clase}
                  className="rounded-vulkan border border-metal-800 bg-metal-950 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-display text-[13px] uppercase tracking-hud">
                      {a.title ?? a.kind}
                    </span>
                    <Badge variant={TONO[lectura.clase]}>{ETIQUETA[lectura.clase]}</Badge>
                  </div>
                  <p className="mt-2 text-[12px] text-metal-400">{lectura.quePasa}</p>
                  {lectura.sePuedeAprobar && (
                    <button
                      type="button"
                      data-testid="aprobar"
                      disabled={pendiente}
                      onClick={() => aprobar(a.id)}
                      className="mt-3 rounded-vulkan border border-vulkan-orange px-3 py-1.5 font-display text-[11px] uppercase tracking-hud text-vulkan-orange disabled:opacity-50"
                    >
                      {pendiente ? "APPROVING..." : "APPROVE"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
