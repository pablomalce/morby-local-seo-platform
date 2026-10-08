/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un despliegue con `VULKAN_PROFILE_READ_SECRET` y SIN
 * `SUPABASE_SERVICE_ROLE_KEY` conteste un 500 genérico a un pedido bien
 * firmado. El contrato no tiene 500: una lectura que no se pudo hacer es
 * `502 lectura-fallida`, sin detalle.
 *
 * Lo encontró la revisión del 2026-10-07: `createSupabaseAdminClient()` se
 * llamaba fuera de todo `try`, y `createClient` de supabase-js TIRA sin la clave
 * («supabaseKey is required.»). Next lo convertía en un 500.
 *
 * Por qué un archivo aparte de `route.test.ts`: allá el módulo del cliente de
 * servicio está reemplazado por un doble (`vi.mock`, que se iza al principio del
 * archivo), y lo que hay que medir acá es lo que hace el módulo REAL —el de
 * supabase-js— cuando falta la variable. Con un doble que tira, el test sólo
 * probaría que el doble tira.
 *
 * Sin red: si el cliente llegara a construirse, cualquier `fetch` cae acá.
 *
 * MEDIDO con `scripts/mutar.sh` (2026-10-08, G-R1): sacar la lectura del
 * `try` de la ruta pone este test en rojo (la llamada tira «supabaseKey is
 * required.»), junto con los bloques 6 y 9 de `route.test.ts`. Y en 836f89f,
 * antes del arreglo, este archivo daba rojo por lo mismo.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const SECRETO = "secreto-de-prueba-sin-llave";
const ORG = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00";
const NEGOCIO = "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c11";

/** Firmado como dice el contrato (el texto, no el módulo): ver route.test.ts. */
function firmar(ts: string): string {
  return createHmac("sha256", SECRETO)
    .update("GET\n/api/profile/published\n" + ORG + "\n" + NEGOCIO + "\n" + ts, "utf8")
    .digest("hex");
}

const respaldo: Record<string, string | undefined> = {};
const VARIABLES = ["VULKAN_PROFILE_READ_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

beforeEach(() => {
  for (const v of VARIABLES) respaldo[v] = process.env[v];
  process.env.VULKAN_PROFILE_READ_SECRET = SECRETO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proyecto-inexistente.supabase.co";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("la ruta salió a la red sin clave de servicio");
    })
  );
  vi.resetModules();
});

afterEach(() => {
  for (const v of VARIABLES) {
    if (respaldo[v] === undefined) delete process.env[v];
    else process.env[v] = respaldo[v];
  }
  vi.unstubAllGlobals();
});

it("firmado bien y sin SUPABASE_SERVICE_ROLE_KEY: 502 «lectura-fallida», sin el mensaje de supabase-js", async () => {
  // Anti-vacuidad: el módulo real de verdad tira sin la clave. Si un día deja
  // de tirar, este test tiene que decir que ya no mide lo que dice medir.
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  expect(() => createSupabaseAdminClient()).toThrow(/supabaseKey/);

  const { GET } = await import("@/app/api/profile/published/route");
  const ts = String(Math.floor(Date.now() / 1000));
  const url = `https://growthos.test/api/profile/published?organization_id=${ORG}&business_id=${NEGOCIO}`;

  const res = await GET(
    new Request(url, { headers: { "x-vulkan-timestamp": ts, "x-vulkan-signature": firmar(ts) } })
  );
  const texto = await res.text();

  expect(res.status).toBe(502);
  expect(JSON.parse(texto)).toEqual({ error: "lectura-fallida" });
  expect(texto).not.toContain("supabaseKey");
  expect(fetch).not.toHaveBeenCalled();
});
