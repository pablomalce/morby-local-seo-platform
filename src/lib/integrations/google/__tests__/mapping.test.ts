/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la validación de la pantalla se separe del CHECK de la `0017` sin que nada
 * lo diga.
 *
 * Los valores de abajo están ESCRITOS, uno por uno, y no derivados de la
 * expresión regular que prueban. Un test que importa la constante que prueba no
 * prueba nada: si mañana alguien afloja el patrón, un test escrito contra el
 * patrón afloja con él y sigue en verde. El literal es lo único que mide.
 *
 * Cada valor válido de acá es una forma que una API de Google devuelve de
 * verdad, y cada inválido es una manera concreta en que un humano la escribe
 * mal.
 */
import { describe, expect, it } from "vitest";
import { FORMA_ESPERADA, patronDe, validarPropertyRef } from "@/lib/integrations/google/mapping";

describe("GA4 — properties/N", () => {
  it("acepta el identificador tal como lo devuelve la API", () => {
    expect(validarPropertyRef("ga4", "properties/123456789")).toEqual({
      ok: true,
      propertyRef: "properties/123456789",
    });
  });

  it("rechaza el número solo, que es como se copia de la interfaz de GA4", () => {
    // Y es el caso que hace que la unicidad global signifique algo: `123456789`
    // y `properties/123456789` son la misma property para Google y dos filas
    // distintas para PostgreSQL.
    expect(validarPropertyRef("ga4", "123456789")).toEqual({ ok: false, rechazo: "forma" });
  });

  it("rechaza el prefijo en plural equivocado y el que no es numérico", () => {
    expect(validarPropertyRef("ga4", "property/123456789")).toEqual({ ok: false, rechazo: "forma" });
    expect(validarPropertyRef("ga4", "properties/G-ABC123")).toEqual({ ok: false, rechazo: "forma" });
    expect(validarPropertyRef("ga4", "properties/")).toEqual({ ok: false, rechazo: "forma" });
  });

  it("rechaza la forma de otra superficie", () => {
    expect(validarPropertyRef("ga4", "locations/123456789")).toEqual({ ok: false, rechazo: "forma" });
  });
});

describe("Search Console — https://sitio/ o sc-domain:host", () => {
  it("acepta la propiedad de prefijo de URL, con la barra final", () => {
    expect(validarPropertyRef("search_console", "https://ejemplo.com/")).toEqual({
      ok: true,
      propertyRef: "https://ejemplo.com/",
    });
  });

  it("rechaza la misma URL sin la barra final", () => {
    // Ninguna respuesta de Search Console produce este valor y un humano lo
    // escribe siempre. No se le agrega la barra: reparar un identificador es
    // convertir lo que el operador NO copió en algo que pasa.
    expect(validarPropertyRef("search_console", "https://ejemplo.com")).toEqual({
      ok: false,
      rechazo: "forma",
    });
  });

  it("acepta una propiedad de dominio", () => {
    expect(validarPropertyRef("search_console", "sc-domain:ejemplo.com")).toEqual({
      ok: true,
      propertyRef: "sc-domain:ejemplo.com",
    });
  });

  it("rechaza sc-domain con mayúsculas, porque la base lo rechaza", () => {
    // El operador `~` de PostgreSQL distingue mayúsculas y el CHECK escribe
    // `[a-z0-9.-]`. Aceptarlo acá sería mandarle al operador un error de
    // PostgreSQL en vez de una explicación.
    expect(validarPropertyRef("search_console", "sc-domain:Ejemplo.com")).toEqual({
      ok: false,
      rechazo: "forma",
    });
  });

  it("acepta http además de https, y una ruta", () => {
    expect(validarPropertyRef("search_console", "http://ejemplo.com/")).toEqual({
      ok: true,
      propertyRef: "http://ejemplo.com/",
    });
    expect(validarPropertyRef("search_console", "https://ejemplo.com/tienda/")).toEqual({
      ok: true,
      propertyRef: "https://ejemplo.com/tienda/",
    });
  });

  it("rechaza el dominio pelado y el prefijo sin dos puntos", () => {
    expect(validarPropertyRef("search_console", "ejemplo.com")).toEqual({ ok: false, rechazo: "forma" });
    expect(validarPropertyRef("search_console", "sc-domain ejemplo.com")).toEqual({
      ok: false,
      rechazo: "forma",
    });
  });

  it("rechaza una URL con un espacio adentro", () => {
    // `[^[:space:]]` en el CHECK, `\\S` acá. Es la misma clase y tiene que
    // rechazar lo mismo.
    expect(validarPropertyRef("search_console", "https://ejemplo .com/")).toEqual({
      ok: false,
      rechazo: "forma",
    });
  });
});

describe("Google Business Profile — locations/N", () => {
  it("acepta el identificador tal como lo devuelve la API", () => {
    expect(validarPropertyRef("google_business_profile", "locations/123456789")).toEqual({
      ok: true,
      propertyRef: "locations/123456789",
    });
  });

  it("rechaza la forma con la cuenta adelante, que es la otra que devuelve Google", () => {
    expect(
      validarPropertyRef("google_business_profile", "accounts/111/locations/123456789")
    ).toEqual({ ok: false, rechazo: "forma" });
  });
});

describe("lo que se recorta y lo que no", () => {
  it("recorta los espacios de los extremos, que los trae el portapapeles", () => {
    expect(validarPropertyRef("ga4", "  properties/123456789\n")).toEqual({
      ok: true,
      propertyRef: "properties/123456789",
    });
  });

  it("un campo vacío se distingue de una forma equivocada", () => {
    // Son dos mensajes distintos para el operador: «falta» y «está mal».
    expect(validarPropertyRef("ga4", "")).toEqual({ ok: false, rechazo: "vacio" });
    expect(validarPropertyRef("ga4", "   ")).toEqual({ ok: false, rechazo: "vacio" });
  });

  it("una superficie que no está en el vocabulario de la 0017 se rechaza", () => {
    // El CHECK termina en `ELSE false` por esto mismo: un `provider` nuevo no
    // entra sin comprobación de forma.
    expect(validarPropertyRef("google", "properties/123456789")).toEqual({
      ok: false,
      rechazo: "superficie-desconocida",
    });
    expect(validarPropertyRef("", "properties/1")).toEqual({
      ok: false,
      rechazo: "superficie-desconocida",
    });
  });
});

describe("lo que se le muestra al operador", () => {
  it("nombra las tres formas canónicas", () => {
    expect(FORMA_ESPERADA.ga4).toBe("properties/N");
    expect(FORMA_ESPERADA.google_business_profile).toBe("locations/N");
    // La barra final se nombra explícitamente porque es lo que más se escribe mal.
    expect(FORMA_ESPERADA.search_console).toContain("sc-domain:host");
    expect(FORMA_ESPERADA.search_console).toContain("barra final");
  });
});

describe("los patrones están clavados a un literal escrito", () => {
  /**
   * Esto es la mitad de un par. La otra mitad es `supabase/qa/forma_canonica.sql`,
   * que clava los MISMOS tres literales contra `pg_get_constraintdef()` del
   * CHECK de la `0017`. Cambiar una sola de las dos mitades pone algo en rojo;
   * sin el par, `mapping.ts` y la base se separan en silencio y el operador se
   * entera por un error de PostgreSQL.
   *
   * Y van escritos, no leídos del módulo: un test que importa el patrón que
   * prueba se afloja junto con él.
   */
  it("GA4", () => {
    expect(patronDe("ga4")).toBe("^properties\\/[0-9]+$");
  });

  it("Search Console", () => {
    expect(patronDe("search_console")).toBe("^(sc-domain:[a-z0-9.-]+|https?:\\/\\/\\S+\\/)$");
  });

  it("Google Business Profile", () => {
    expect(patronDe("google_business_profile")).toBe("^locations\\/[0-9]+$");
  });
});
