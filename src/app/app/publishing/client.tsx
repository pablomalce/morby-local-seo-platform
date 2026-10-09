"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Card, HudLabel, Select } from "@/components/ui";
import { LEDGER_VACIO, leerFila, type FilaLedger, type ClaseDeFila } from "@/lib/publishing/ledgerView";
import {
  EL_ENSAYO_ESCRIBE,
  LECTURAS,
  SIN_APROBADOS,
  lecturaDeEnsayo,
  salioBien,
  type AssetEnsayable,
  type LecturaDeEnsayo,
} from "@/lib/publishing/ensayoVisto";

/**
 * QUÉ IMPIDE ESTE BLOQUE
 *
 * Que `POST /api/publishing/rehearse` siga siendo una ruta que nadie llama.
 *
 * Es el defecto que este repositorio ya se comió cinco veces —el transporte con
 * sus 19 tests, el publicador, la ruta de contenido— y el encabezado de
 * `rehearse/route.ts` ya advertía contra él. Al 2026-09-26 esta pantalla era de
 * sólo lectura: el ledger se podía mirar y el ensayo sólo se podía disparar con
 * `curl`. Por eso `client.test.tsx` afirma sobre la LLAMADA —a dónde va y con
 * QUÉ cuerpo—, y no sobre el aspecto del botón.
 *
 * POR QUÉ VIVE EN LA MISMA PANTALLA QUE EL LEDGER
 *
 * Porque el resultado de un ensayo ES una fila del ledger. Separarlos obligaría
 * a creerle a un cartel en vez de mirar el registro, que es exactamente lo que
 * el ledger existe para evitar.
 *
 * EL ENSAYO Y NADA MÁS
 *
 * No hay modo, no hay campo y no hay botón de publicación real: el modo es un
 * literal del servidor, y mandarlo desde acá convertiría un ensayo en un envío a
 * la ficha de un cliente. La pantalla no ofrece lo que el producto no puede
 * hacer todavía.
 */
export function EnsayoDePublicacion({
  aprobados,
  puedeEnsayar,
}: {
  aprobados: AssetEnsayable[];
  /**
   * Si el rol de quien mira ensaya en esta organización (D4: owner, admin o
   * manager, los mismos que aprueban). Decide si se DIBUJA el botón; la ruta
   * contesta 403 igual. Hasta el 2026-10-08 el botón se le ofrecía a cualquier
   * miembro, y el 403 se leía como «defecto del código» (crítico del
   * 2026-10-08): `ensayoVisto.ts` tiene ahora su lectura.
   */
  puedeEnsayar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [elegido, setElegido] = useState(aprobados[0]?.id ?? "");
  const [enVuelo, setEnVuelo] = useState(false);
  const [lectura, setLectura] = useState<{ de: string; leida: LecturaDeEnsayo } | null>(null);

  /**
   * El asset que el botón va a mandar, DERIVADO de la lista y no guardado.
   *
   * `aprobados` cambia debajo en cada `router.refresh()`, y un id guardado que
   * ya no está en la lista dejaba al `<select>` mostrando el primero mientras
   * el botón mandaba el que se fue. Medido por un escéptico: el selector decía
   * A y el ensayo era de B.
   */
  const aEnsayar = aprobados.some((a) => a.id === elegido) ? elegido : (aprobados[0]?.id ?? "");
  const etiqueta = (a: AssetEnsayable) => `${a.title ?? a.kind} · ${a.locale}`;
  const nombreDe = (id: string) => {
    const a = aprobados.find((x) => x.id === id);
    return a ? etiqueta(a) : id;
  };

  async function ensayar() {
    // El cerrojo del vuelo, y no `pendiente`: `useTransition` sólo está
    // pendiente DESPUÉS del fetch, durante el refresh, así que dos clicks
    // seguidos disparaban dos ensayos. Un escéptico lo midió.
    if (!aEnsayar || enVuelo) return;
    setEnVuelo(true);
    setLectura(null);

    try {
      // Sólo el `assetId`. La organización y el `approvedHash` los lee el
      // servidor del asset —mandar el hash de ayer sería ensayar el texto de
      // ayer— y el modo es un literal de la ruta.
      const res = await fetch("/api/publishing/rehearse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: aEnsayar }),
      });
      const cuerpo = await res.json().catch(() => ({}));

      // El motivo se muestra, no se traga: los códigos de esta ruta se arreglan
      // en lugares distintos. Ver `ensayoVisto.ts`.
      const leida = lecturaDeEnsayo(res.status, cuerpo);
      setLectura({ de: aEnsayar, leida });

      // Sin esto, la fila recién reservada no se ve hasta que alguien recarga a
      // mano — y entonces el único testigo del ensayo sería este cartel.
      if (salioBien(leida.clase)) startTransition(() => router.refresh());
    } catch {
      // El `fetch` que no llega a contestar. Sin este catch la pantalla no
      // mostraba nada y el click se leía como si no hubiera pasado — y pudo
      // haber pasado.
      setLectura({ de: aEnsayar, leida: LECTURAS["sin-respuesta"] });
    } finally {
      setEnVuelo(false);
    }
  }

  return (
    <Card className="mt-6">
      <HudLabel>REHEARSAL</HudLabel>
      <p className="mt-3 text-[12px] text-metal-400">{EL_ENSAYO_ESCRIBE}</p>

      {!puedeEnsayar ? (
        <p className="mt-4 text-[12px] text-metal-400" data-testid="sin-rol-para-ensayar">
          Con tu rol en esta organización ves el ledger; ensayar y publicar lo hace un owner, admin o
          manager.
        </p>
      ) : aprobados.length === 0 ? (
        <div
          className="mt-4 rounded-vulkan border border-metal-800 bg-metal-950 p-4"
          data-testid="sin-aprobados"
        >
          <p className="text-[12px] text-metal-300">{SIN_APROBADOS.quePaso}</p>
          <p className="mt-2 text-[12px] text-metal-400">{SIN_APROBADOS.queHacer}</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Select
            data-testid="elegir-asset"
            aria-label="Asset aprobado"
            value={aEnsayar}
            onChange={(e) => setElegido(e.target.value)}
            className="max-w-xs"
          >
            {aprobados.map((a) => (
              <option key={a.id} value={a.id}>
                {etiqueta(a)}
              </option>
            ))}
          </Select>
          <button
            type="button"
            data-testid="ensayar"
            disabled={enVuelo || pendiente}
            onClick={ensayar}
            className="rounded-vulkan border border-vulkan-orange px-4 py-2 font-display text-[12px] uppercase tracking-hud text-vulkan-orange disabled:opacity-50"
          >
            {enVuelo || pendiente ? "REHEARSING..." : "REHEARSE"}
          </button>
        </div>
      )}

      {/*
        El cartel NOMBRA el asset que se ensayó, y no es decoración: sobrevive a
        que alguien cambie el selector, y sin el nombre se leería como si fuera
        del asset que ahora está elegido. Medido por un escéptico.
      */}
      {lectura &&
        (salioBien(lectura.leida.clase) ? (
          <div
            data-testid="resultado-ensayo"
            data-clase={lectura.leida.clase}
            data-de={lectura.de}
            className="mt-4 rounded-vulkan border border-metal-800 bg-metal-950 p-3"
          >
            <p className="text-[12px] text-metal-500">{nombreDe(lectura.de)}</p>
            <p data-testid="ensayo-que-paso" className="mt-1 text-[12px] text-metal-300">
              {lectura.leida.quePaso}
            </p>
            {lectura.leida.queHacer && (
              <p className="mt-1 text-[12px] text-metal-400">{lectura.leida.queHacer}</p>
            )}
          </div>
        ) : (
          <div
            data-testid="error-ensayo"
            data-clase={lectura.leida.clase}
            data-de={lectura.de}
            className="mt-4 rounded-vulkan border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-200"
          >
            <p className="text-red-300/80">{nombreDe(lectura.de)}</p>
            <p data-testid="ensayo-que-paso" className="mt-1">
              {lectura.leida.quePaso}
            </p>
            {lectura.leida.queHacer && <p className="mt-1 text-red-100">{lectura.leida.queHacer}</p>}
          </div>
        ))}
    </Card>
  );
}

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
