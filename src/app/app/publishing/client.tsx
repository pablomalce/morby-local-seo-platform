"use client";

import { Badge, Card, HudLabel } from "@/components/ui";
import { LEDGER_VACIO, leerFila, type FilaLedger, type ClaseDeFila } from "@/lib/publishing/ledgerView";

/** El tono de cada lectura. `incoherente` es crítico: dice que una garantía se cayó. */
const TONO: Record<ClaseDeFila, "success" | "orange" | "critical" | "hud"> = {
  publicada: "success",
  reservada: "hud",
  "intento-perdido": "orange",
  fallada: "critical",
  incoherente: "critical",
};

const ETIQUETA: Record<ClaseDeFila, string> = {
  publicada: "PUBLISHED",
  reservada: "RESERVED",
  "intento-perdido": "ATTEMPT LOST",
  fallada: "FAILED",
  incoherente: "LEDGER BROKEN",
};

export function Ledger({ filas }: { filas: FilaLedger[] }) {
  return (
    <Card className="mt-6">
      <HudLabel>PUBLICATION LEDGER</HudLabel>
      <p className="mt-3 text-[12px] text-metal-400">
        Una fila por asset y destino. La unicidad es la idempotencia: un reintento no crea una
        segunda, y el ensayo usa la misma fila que después usa el envío en vivo.
      </p>

      {filas.length === 0 ? (
        <div className="mt-4 rounded-vulkan border border-metal-800 bg-metal-950 p-4" data-testid="ledger-vacio">
          <p className="text-[12px] text-metal-300">{LEDGER_VACIO.quePaso}</p>
          <p className="mt-2 text-[12px] text-metal-400">{LEDGER_VACIO.queHacer}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filas.map((fila) => {
            const lectura = leerFila(fila);
            return (
              <div
                key={fila.id}
                data-testid="ledger-fila"
                data-clase={lectura.clase}
                className="rounded-vulkan border border-metal-800 bg-metal-950 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    {fila.destination}
                  </span>
                  <Badge variant={TONO[lectura.clase]}>{ETIQUETA[lectura.clase]}</Badge>
                </div>
                <p className="mt-2 text-[12px] text-metal-300">{lectura.quePaso}</p>
                {lectura.queHacer && (
                  <p className="mt-1 text-[12px] text-metal-400">{lectura.queHacer}</p>
                )}
                <p className="mt-2 truncate font-mono text-[10px] text-metal-600">
                  asset {fila.assetId}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
