"use client";

import { useState } from "react";
import { Badge, Card, HudLabel } from "@/components/ui";
import type { Gravedad, Hallazgo } from "@/lib/aeo/hallazgos";
import type { ResultadoRenderizado } from "@/lib/aeo/renderizado";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que la auditoría exista y nadie la corra — el defecto que este proyecto ya se
 * comió seis veces.
 *
 * Y que un hallazgo se muestre sin decir dónde se arregla: un bloqueo de
 * rastreadores lo toca quien maneja el `robots.txt` o el CDN, y un sitio sin
 * texto sin JavaScript lo toca quien hace el sitio. Son dos personas distintas.
 *
 * Y que el texto servido se muestre sin el renderizado al lado. La puerta
 * H2-GO-1 pide los DOS números crudos, uno frente al otro: con uno solo no se
 * distingue una página corta de una que se dibuja en el cliente. Si el
 * renderizado no se pudo medir, el lugar del número dice «no medido» y por qué
 * —nunca un cero, que se leería como «la página no tiene texto»—.
 */

const TONO: Record<Gravedad, "critical" | "orange" | "hud" | "outline"> = {
  bloqueante: "critical",
  importante: "orange",
  informativo: "hud",
  "no-medido": "outline",
};

const ETIQUETA: Record<Gravedad, string> = {
  bloqueante: "BLOQUEANTE",
  importante: "IMPORTANTE",
  informativo: "INFORMATIVO",
  "no-medido": "NO MEDIDO",
};

interface Resultado {
  url: string;
  robotsLeido: boolean;
  /** RFC 9309: leído, «no hay» (4xx, deja entrar a todos) o sin medir (5xx, timeout, red). */
  estadoRobots?: "leido" | "ausente" | "no-medido";
  motivoRobots: string | null;
  hallazgos: Hallazgo[];
  /**
   * `true` sólo sin bloqueantes y con los tres ejes medidos; `null` es «no se
   * sabe». Es lo único que habilita la frase de «sin hallazgos» (P3): una
   * lista vacía sola no la habilita.
   */
  legible?: boolean | null;
  /** Si la corrida quedó en `aeo_audits`. Hoy, contra la base real, no (ver `DatosCrudos`). */
  guardada?: boolean;
  /** Opcional: una respuesta sin lectura no rompe la pantalla, y no muestra números. */
  lectura?: {
    caracteresSinJs: number;
    caracteresRenderizados?: ResultadoRenderizado;
    /** Lo que el robots declara por agente; `null` es «no se pudo leer». */
    acceso?: Record<string, boolean | null>;
    /** El código HTTP de la petición con el user-agent de cada agente; `null` es «no contestó». */
    statusPorAgente?: Record<string, number | null>;
    schema?: string[];
    erroresDeSchema?: string[];
  };
}

/**
 * Los datos CRUDOS que la puerta H2-GO-1 pide para la web real: el código por
 * agente, los tipos de schema y los errores del validador. Antes sólo
 * aparecían dentro del texto de un hallazgo cuando había un problema, así que
 * un sitio sano no mostraba ninguno, y comparar dos URLs pedía abrir devtools
 * (P6). Tampoco quedan guardados: `aeo_audits` no acepta la escritura de una
 * sesión (0025), y la pantalla lo dice en vez de callarlo.
 */
function DatosCrudos({ lectura, guardada }: { lectura: NonNullable<Resultado["lectura"]>; guardada?: boolean }) {
  const agentes = Object.keys({ ...(lectura.acceso ?? {}), ...(lectura.statusPorAgente ?? {}) });
  const robots = (v: boolean | null | undefined) => (v === true ? "permite" : v === false ? "bloquea" : "sin medir");
  return (
    <div className="mt-3 rounded-vulkan border border-metal-800 bg-metal-950 p-3" data-testid="datos-crudos">
      <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">Datos crudos</p>
      {agentes.length > 0 && (
        <table className="mt-2 w-full text-left text-[12px] text-metal-300">
          <thead>
            <tr className="text-metal-500">
              <th className="font-normal">Agente</th>
              <th className="font-normal">robots.txt</th>
              <th className="font-normal">HTTP con su user-agent</th>
            </tr>
          </thead>
          <tbody>
            {agentes.map((a) => {
              const status = lectura.statusPorAgente?.[a];
              return (
                <tr key={a} data-testid="dato-agente" data-agente={a}>
                  <td className="font-mono">{a}</td>
                  <td>{robots(lectura.acceso?.[a])}</td>
                  <td data-testid="dato-http">{typeof status === "number" ? status : "sin respuesta"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[12px] text-metal-300" data-testid="dato-schema">
        Schema: {lectura.schema && lectura.schema.length > 0 ? lectura.schema.join(", ") : "ninguno"}
      </p>
      <p className="mt-1 text-[12px] text-metal-300" data-testid="dato-errores-schema">
        Errores del JSON-LD:{" "}
        {lectura.erroresDeSchema && lectura.erroresDeSchema.length > 0 ? lectura.erroresDeSchema.join("; ") : "ninguno"}
      </p>
      {guardada === false && (
        <p className="mt-2 text-[11px] text-metal-500" data-testid="no-guardada">
          Esta corrida no quedó guardada: lo que ves acá es lo único que hay de ella.
        </p>
      )}
    </div>
  );
}

function TextoComparado({ lectura }: { lectura: NonNullable<Resultado["lectura"]> }) {
  const render = lectura.caracteresRenderizados;
  // El número que la puerta nombra: los caracteres de texto del HTML sin
  // ejecutar JavaScript. Si el render lo midió, el del MISMO documento que se
  // renderizó; si no, el del HTML que trajo la ruta. Ninguno aplica CSS: un
  // rastreador sin JavaScript tampoco lo aplica (GATE-1).
  const servido = render?.estado === "medido" && render.servidos !== undefined ? render.servidos : lectura.caracteresSinJs;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2" data-testid="texto-comparado">
      <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-3">
        <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
          Sin JavaScript · texto del HTML
        </p>
        <p className="mt-1 text-[13px] text-metal-200" data-testid="texto-servido">
          {servido.toLocaleString("es")} caracteres
        </p>
      </div>
      <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-3">
        <p className="font-mono text-[10px] uppercase tracking-hud text-metal-500">
          Renderizado · texto del DOM en Chromium
        </p>
        {render?.estado === "medido" ? (
          <p className="mt-1 text-[13px] text-metal-200" data-testid="texto-renderizado" data-estado="medido">
            {render.caracteres.toLocaleString("es")} caracteres
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-metal-400" data-testid="texto-renderizado" data-estado="no-medido">
            no medido ({render?.estado === "fallo" ? render.codigo : "sin dato"})
          </p>
        )}
      </div>
    </div>
  );
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
              : cuerpo.motivo === "destino-rechazado"
                ? `La dirección del sitio no se audita (${cuerpo.detalle ?? "sin detalle"}): sólo se piden sitios públicos, por http o https, en los puertos 80 y 443. Si redirige, cada salto tiene que cumplirlo.`
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
        y cuánto del texto existe sin ejecutar JavaScript frente al que dibuja un navegador. Las dos
        cosas son la mitad del resultado.
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

          {resultado.lectura && <TextoComparado lectura={resultado.lectura} />}
          {resultado.lectura && <DatosCrudos lectura={resultado.lectura} guardada={resultado.guardada} />}

          {!resultado.robotsLeido &&
            (resultado.estadoRobots === "ausente" ? (
              <p className="mt-2 text-[12px] text-metal-400" data-testid="robots-no-leido" data-estado="ausente">
                No hay <code>robots.txt</code> ({resultado.motivoRobots}). Según el estándar, eso deja
                entrar a todos los rastreadores, y así se calculó el acceso.
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-metal-400" data-testid="robots-no-leido" data-estado="no-medido">
                No se pudo leer el <code>robots.txt</code> ({resultado.motivoRobots}). El acceso por
                robots quedó SIN MEDIR: no es «permite», y un 5xx que se repite hace que los
                rastreadores asuman que no pueden entrar a nada.
              </p>
            ))}

          {resultado.hallazgos.length === 0 && resultado.legible === true ? (
            <p className="mt-3 text-[13px] text-metal-300" data-testid="sin-hallazgos">
              Los rastreadores entran, el contenido existe sin JavaScript y el schema que importa
              está declarado.
            </p>
          ) : resultado.hallazgos.length === 0 ? (
            <p className="mt-3 text-[13px] text-metal-400" data-testid="sin-veredicto">
              La auditoría no trae un veredicto: sin hallazgos y sin la confirmación de que los tres
              ejes se midieron, no se puede decir que el sitio esté bien.
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
