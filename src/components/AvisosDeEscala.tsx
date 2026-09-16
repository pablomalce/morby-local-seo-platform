"use client";

import { useState } from "react";
import { Badge, Card, HudLabel } from "@/components/ui";
import { avisosDeEscala, type ClaseDeAviso } from "@/lib/limites/avisos";

/**
 * QUÉ IMPIDE ESTE COMPONENTE
 *
 * Que los límites de escala se descubran cuando ya molestan.
 *
 * NACE PLEGADO A PROPÓSITO
 *
 * Un panel abierto con cinco advertencias sobre cosas que todavía no pasan
 * enseña a ignorar los paneles. Se muestra el resumen —cuántos hay y de qué
 * clase— y el detalle se abre cuando alguien lo quiere.
 */

const TONO: Record<ClaseDeAviso, "critical" | "orange" | "hud"> = {
  ahora: "orange",
  pronto: "hud",
  fechado: "hud",
};

const ETIQUETA: Record<ClaseDeAviso, string> = {
  ahora: "YA APLICA",
  pronto: "SE VIENE",
  fechado: "FOTO",
};

export function AvisosDeEscala({ clientes }: { clientes: number }) {
  const [abierto, setAbierto] = useState(false);
  const avisos = avisosDeEscala(clientes);
  const ahora = avisos.filter((a) => a.clase === "ahora").length;

  return (
    <Card className="mt-4">
      <button
        type="button"
        data-testid="abrir-avisos"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <HudLabel>SCALE &amp; LIMITS</HudLabel>
          <span className="mt-2 block text-[12px] text-metal-400" data-testid="resumen-avisos">
            {clientes} {clientes === 1 ? "cliente" : "clientes"} ·{" "}
            {ahora === 0
              ? "ningún límite aplica todavía"
              : `${ahora} ${ahora === 1 ? "límite ya aplica" : "límites ya aplican"}`}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-hud text-metal-500">
          {abierto ? "CERRAR" : "VER"}
        </span>
      </button>

      {abierto && (
        <div className="mt-4 space-y-2" data-testid="detalle-avisos">
          {avisos.map((a, i) => (
            <div
              key={i}
              data-testid="aviso"
              data-clase={a.clase}
              className="rounded-vulkan border border-metal-800 bg-metal-950 p-4"
            >
              <Badge variant={TONO[a.clase]}>{ETIQUETA[a.clase]}</Badge>
              <p className="mt-2 font-display text-[12px] uppercase tracking-hud text-vulkan-white">
                {a.titulo}
              </p>
              <p className="mt-1 text-[12px] text-metal-400">{a.detalle}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                se resuelve en: {a.donde}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
