"use client";

import { useState } from "react";
import { Badge, Card, HudLabel } from "@/components/ui";
import type { Gravedad, Hallazgo } from "@/lib/aeo/hallazgos";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la auditoría exista y nadie la corra — el defecto que este proyecto ya se
 * comió seis veces.
 *
 * Y que un hallazgo se muestre sin decir dónde se arregla: un bloqueo de
 * rastreadores lo toca quien maneja el `robots.txt` o el CDN, y un sitio sin
 * texto sin JavaScript lo toca quien hace el sitio. Son dos personas distintas.
 */

const TONO: Record<Gravedad, "critical" | "orange" | "hud"> = {
  bloqueante: "critical",
  importante: "orange",
  informativo: "hud",
};

const ETIQUETA: Record<Gravedad, string> = {
  bloqueante: "BLOQUEANTE",
  importante: "IMPORTANTE",
  informativo: "INFORMATIVO",
};

interface Resultado {
  url: string;
  robotsLeido: boolean;
  motivoRobots: string | null;
  hallazgos: Hallazgo[];
}

export function AuditoriaAeo({ businessId }: { businessId: string | null }) {
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function auditar() {
    if (!businessId) return;
    setCorriendo(true);
    setError(null);
    setResultado(null);

    const res = await fetch("/api/aeo/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId }),
    });
    const cuerpo = (await res.json().catch(() => ({}))) as Partial<Resultado> & {
      motivo?: string;
      detalle?: string;
    };
    setCorriendo(false);

    if (!res.ok) {
      // Cada motivo con su frase: «no hay sitio cargado» y «el sitio no
      // responde» mandan a lugares distintos, y un mensaje único los fundiría.
      const dicho =
        cuerpo.motivo === "sin-sitio"
          ? "Este cliente no tiene sitio cargado, así que no hay nada que auditar. Se agrega en su negocio."
          : cuerpo.motivo === "sitio-inalcanzable"
            ? `El sitio no respondió (${cuerpo.detalle ?? "sin detalle"}). Eso NO significa que esté bien ni mal: no se pudo mirar.`
            : cuerpo.motivo === "sitio-ilegible"
              ? "La dirección cargada no es una URL válida."
              : `No se pudo auditar (${res.status}).`;
      setError(dicho);
      return;
    }

    setResultado(cuerpo as Resultado);
  }

  return (
    <Card className="mt-6">
      <HudLabel>AI READABILITY</HudLabel>
      <p className="mt-3 text-[12px] text-metal-400">
        Mide lo que decide si un motor de IA puede leer el sitio: si los rastreadores pueden entrar,
        y si el contenido existe sin ejecutar JavaScript. Las dos cosas son binarias y son la mitad
        del resultado.
      </p>

      <button
        type="button"
        data-testid="auditar"
        disabled={corriendo || !businessId}
        onClick={auditar}
        className="mt-4 rounded-vulkan border border-vulkan-orange px-4 py-2 font-display text-[12px] uppercase tracking-hud text-vulkan-orange disabled:opacity-50"
      >
        {corriendo ? "AUDITANDO..." : "AUDITAR EL SITIO"}
      </button>

      {!businessId && (
        <p className="mt-3 text-[12px] text-metal-400" data-testid="sin-negocio">
          Esta organización no tiene ningún negocio, así que no hay sitio que auditar.
        </p>
      )}

      {error && (
        <p
          data-testid="error-auditoria"
          className="mt-4 rounded-vulkan border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-200"
        >
          {error}
        </p>
      )}

      {resultado && (
        <div className="mt-4" data-testid="resultado">
          <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
            {resultado.url}
          </p>

          {!resultado.robotsLeido && (
            <p className="mt-2 text-[12px] text-metal-400" data-testid="robots-no-leido">
              No se pudo leer el <code>robots.txt</code> ({resultado.motivoRobots}). El acceso de
              abajo se calculó como si no hubiera reglas — que es lo que el estándar dice, pero no
              es lo mismo que haberlo comprobado.
            </p>
          )}

          {resultado.hallazgos.length === 0 ? (
            <p className="mt-3 text-[13px] text-metal-300" data-testid="sin-hallazgos">
              Los rastreadores entran, el contenido existe sin JavaScript y el schema que importa
              está declarado.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {resultado.hallazgos.map((h, i) => (
                <div
                  key={i}
                  data-testid="hallazgo"
                  data-gravedad={h.gravedad}
                  className="rounded-vulkan border border-metal-800 bg-metal-950 p-4"
                >
                  <Badge variant={TONO[h.gravedad]}>{ETIQUETA[h.gravedad]}</Badge>
                  <p className="mt-2 text-[12px] text-metal-200">{h.quePasa}</p>
                  <p className="mt-1 text-[12px] text-metal-400">{h.queHacer}</p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                    se arregla en: {h.donde}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
