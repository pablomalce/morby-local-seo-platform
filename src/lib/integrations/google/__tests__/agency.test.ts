import { describe, expect, it, vi } from "vitest";
import {
  AGENCY_ORG_ID_ENV,
  type AgencyTokenState,
  type TokenTimestamps,
  readAgencyTokenState,
  resolveAgencyOrgId,
} from "@/lib/integrations/google/agency";

/**
 * El nombre de la variable se escribe TEXTUAL acá y no se toma de la constante.
 * Un test que arma su entorno con `{ [AGENCY_ORG_ID_ENV]: x }` pasa igual si
 * alguien renombra la variable, porque los dos lados se mueven juntos: lo único
 * que mediría es que la función lee la clave que ella misma nombra.
 */
const NOMBRE = "VULKAN_AGENCY_ORG_ID";

const UUID_VALIDO = "3f1c8a52-6d4b-4e19-9c07-8a2b5d61f0e4";

const entorno = (valor?: string): NodeJS.ProcessEnv =>
  (valor === undefined ? {} : { [NOMBRE]: valor }) as unknown as NodeJS.ProcessEnv;

const VIVO: TokenTimestamps = { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null };

/** Un lector que siempre encuentra la fila, y anota con qué id lo llamaron. */
const lectorQueEncuentra = (row: TokenTimestamps | null = VIVO) =>
  vi.fn(async () => ({ ok: true as const, row }));

describe("el nombre de la variable", () => {
  it("es VULKAN_AGENCY_ORG_ID", () => {
    // Es parte del contrato con el despliegue: cambiarlo sin cambiar Vercel deja
    // la pantalla diciendo «unset» con todo bien configurado.
    expect(AGENCY_ORG_ID_ENV).toBe(NOMBRE);
  });
});

describe("resolveAgencyOrgId", () => {
  it("devuelve el id cuando la variable trae un uuid", () => {
    const r = resolveAgencyOrgId(entorno(UUID_VALIDO));
    expect(r).toEqual({ ok: true, organizationId: UUID_VALIDO });
  });

  it("acepta un uuid en mayúsculas y lo devuelve tal cual llegó", () => {
    // Postgres compara uuid por valor y no por texto, así que rechazar las
    // mayúsculas sería inventar una regla que la base no tiene.
    const r = resolveAgencyOrgId(entorno(UUID_VALIDO.toUpperCase()));
    expect(r).toEqual({ ok: true, organizationId: UUID_VALIDO.toUpperCase() });
  });

  it("recorta los espacios de los bordes", () => {
    // Un valor pegado en un panel web se lleva un salto de línea con una
    // facilidad notable, y ese id no coincide con ninguna organización.
    const r = resolveAgencyOrgId(entorno(`  ${UUID_VALIDO}\n`));
    expect(r).toEqual({ ok: true, organizationId: UUID_VALIDO });
  });

  it("sin la variable es `unset`", () => {
    expect(resolveAgencyOrgId(entorno())).toEqual({ ok: false, reason: "unset" });
  });

  it("con la variable vacía es `unset` y no `malformed`", () => {
    // Declarada y sin valor se arregla igual que no haberla puesto: poniéndola.
    expect(resolveAgencyOrgId(entorno(""))).toEqual({ ok: false, reason: "unset" });
    expect(resolveAgencyOrgId(entorno("   "))).toEqual({ ok: false, reason: "unset" });
  });

  it("con algo que no es un uuid es `malformed`", () => {
    // ÉSTE es el caso que justifica validar. Sin esta rama el id inválido va a
    // la consulta, no encuentra fila, y la pantalla dice «hacé el OAuth» sobre
    // un token que puede estar perfectamente vivo bajo el id bueno.
    for (const basura of ["vulkan", "1234", `${UUID_VALIDO}x`, UUID_VALIDO.replace(/-/g, "")]) {
      expect(resolveAgencyOrgId(entorno(basura)), `con «${basura}»`).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("un uuid con un dígito no hexadecimal es `malformed`", () => {
    // El largo y los guiones están bien; lo único mal es un carácter. Un
    // chequeo por longitud lo dejaría pasar.
    const conZeta = UUID_VALIDO.replace("3f1c8a52", "3f1c8a5z");
    expect(resolveAgencyOrgId(entorno(conZeta))).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("readAgencyTokenState", () => {
  it("no consulta nada cuando no sabe a quién preguntarle", async () => {
    // El orden es la propiedad, no un detalle: consultar primero con un id
    // inválido y leer su vacío como respuesta es el defecto que se está
    // impidiendo.
    const readRow = lectorQueEncuentra();
    const classify = vi.fn(async () => "active");

    const estado = await readAgencyTokenState({ readRow, classify, env: entorno("no-es-uuid") });

    expect(estado).toBe("malformed");
    expect(readRow).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it("le pregunta por la organización que nombra la variable, y no por otra", async () => {
    const readRow = lectorQueEncuentra();
    await readAgencyTokenState({
      readRow,
      classify: async () => "active",
      env: entorno(UUID_VALIDO),
    });
    expect(readRow).toHaveBeenCalledWith(UUID_VALIDO);
  });

  it("sin fila es `absent`, y no clasifica nada", async () => {
    const classify = vi.fn(async () => "active");
    const estado = await readAgencyTokenState({
      readRow: lectorQueEncuentra(null),
      classify,
      env: entorno(UUID_VALIDO),
    });
    expect(estado).toBe("absent");
    expect(classify).not.toHaveBeenCalled();
  });

  it("una lectura que falla es `unreadable` y NO `absent`", async () => {
    // La distinción es la misma que `status.ts` hace entre `error` y `missing`:
    // una consulta que falló no es una integración sin configurar.
    const estado = await readAgencyTokenState({
      readRow: async () => ({ ok: false as const }),
      classify: async () => "active",
      env: entorno(UUID_VALIDO),
    });
    expect(estado).toBe("unreadable");
  });

  it("devuelve los tres estados que la base clasifica, sin reinterpretarlos", async () => {
    for (const dice of ["active", "expired", "revoked"] as const) {
      const estado = await readAgencyTokenState({
        readRow: lectorQueEncuentra(),
        classify: async () => dice,
        env: entorno(UUID_VALIDO),
      });
      expect(estado, `cuando la base dice ${dice}`).toBe(dice as AgencyTokenState);
    }
  });

  it("le pasa a `classify` la fila que leyó, entera", async () => {
    // Si le pasara otra cosa —o la fila reconstruida— la regla de «revocado
    // domina» se aplicaría sobre datos que no son los de la base.
    const revocada: TokenTimestamps = {
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: "2026-08-01T00:00:00.000Z",
    };
    const classify = vi.fn(async () => "revoked");
    await readAgencyTokenState({
      readRow: lectorQueEncuentra(revocada),
      classify,
      env: entorno(UUID_VALIDO),
    });
    expect(classify).toHaveBeenCalledWith(revocada);
  });

  it("una clasificación que falla es `unreadable` y NO cae a `active`", async () => {
    // Un default optimista acá diría «conectado» sobre un token del que no
    // sabemos nada, que es la peor de las respuestas posibles: la única que no
    // manda a nadie a mirar.
    const estado = await readAgencyTokenState({
      readRow: lectorQueEncuentra(),
      classify: async () => null,
      env: entorno(UUID_VALIDO),
    });
    expect(estado).toBe("unreadable");
  });

  it("un valor que la base no debería devolver tampoco pasa por bueno", async () => {
    const estado = await readAgencyTokenState({
      readRow: lectorQueEncuentra(),
      classify: async () => "connected",
      env: entorno(UUID_VALIDO),
    });
    expect(estado).toBe("unreadable");
  });

  it("`undecided` ya no es un estado posible", async () => {
    // La señal de que la decisión de producto se tomó. Ninguna combinación de
    // entradas puede devolverlo.
    const combinaciones: AgencyTokenState[] = [];
    for (const env of [entorno(), entorno("basura"), entorno(UUID_VALIDO)]) {
      for (const row of [null, VIVO]) {
        for (const dice of ["active", "expired", "revoked", null]) {
          combinaciones.push(
            await readAgencyTokenState({
              readRow: lectorQueEncuentra(row),
              classify: async () => dice,
              env,
            })
          );
        }
      }
    }
    expect(combinaciones).not.toContain("undecided");
    expect(combinaciones.length).toBeGreaterThan(0);
  });
});
