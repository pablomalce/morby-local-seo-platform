import { NextResponse, type NextRequest } from "next/server";

/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la página de control de la puerta H2-GO-1 (`public/aeo-control/`) no
 * pueda refutar la mitad «petición HTTP real con el user-agent» del eje de
 * acceso (GATE-6).
 *
 * El control estaba bloqueado SÓLO en el `robots.txt`, y el despliegue le
 * contestaba 200 a los cinco agentes. MEDIDO con una mutación: cambiar los
 * cinco status por 200 fijos dejaba el control rojo 3 de 3, así que el
 * «código registrado» que la puerta exige no se distinguía de un arreglo
 * inventado. Desde acá, el despliegue le contesta 403 a PerplexityBot en la
 * página de control —un agente que el `robots.txt` DEJA entrar—, y el rojo
 * de acceso depende también de la petición: sin ella, ese agente sale verde.
 *
 * Lo corre el middleware (`src/middleware.ts`) antes que cualquier otra cosa,
 * y sólo en `/aeo-control`.
 */

/** El agente al que el control le contesta 403, aunque el robots lo deje entrar. */
export const AGENTE_RECHAZADO_EN_EL_CONTROL = "perplexitybot";

export function rechazoDelControlAeo(request: NextRequest): NextResponse | null {
  const ruta = request.nextUrl.pathname;
  if (ruta !== "/aeo-control" && !ruta.startsWith("/aeo-control/")) return null;
  const agente = request.headers.get("user-agent") ?? "";
  if (!agente.toLowerCase().includes(AGENTE_RECHAZADO_EN_EL_CONTROL)) return null;
  return new NextResponse("403: la página de control de la auditoría AEO rechaza a este agente a propósito.\n", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
