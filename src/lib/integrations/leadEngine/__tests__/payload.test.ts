/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un payload firmado pero mal formado llegue a la base y falle allá, donde
 * el productor sólo ve un 500 y reintenta.
 *
 * El payload de referencia está copiado del contrato
 * —`vulkan-lead-engine/docs/CONTRATO_GROWTH_OS.md`— y ESCRITO acá, no importado
 * de ningún lado. Es contrato con otro repositorio: si el productor lo cambia,
 * lo que tiene que ponerse rojo es esto.
 */
import { describe, expect, it } from "vitest";
import { EVENTO, parseLeadWon } from "@/lib/integrations/leadEngine/payload";

/** El ejemplo del contrato, tal cual. */
function valido(): Record<string, unknown> {
  return {
    event: "lead.won",
    at: "2026-08-29T09:00:00.000Z",
    source: {
      system: "vulkan-lead-engine",
      lead_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
      organization_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b11",
      idempotency_key: "vulkan-lead-engine:lead:018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
    },
    organization: {
      org_id: null,
      display_name: "Sueco AB",
      slug: "sueco-ab",
      default_locale: "sv",
    },
    business: {
      name: "Sueco AB",
      slug: "sueco-ab",
      website: "",
      industry: "Hair Salon",
      primary_locale: "sv",
    },
    locations: [
      {
        label: "Main",
        address_line: "",
        city: "Stockholm",
        region: "",
        country: "SE",
        postal_code: "",
        is_primary: true,
      },
    ],
    contact: {
      display_name: "Sueco AB",
      email: "",
      phone: "",
      website: "",
      source: "",
    },
  };
}

/** El ejemplo con un camino cambiado. */
function con(camino: string, valor: unknown): Record<string, unknown> {
  const v = valido();
  const partes = camino.split(".");
  let nodo: Record<string, unknown> = v;
  for (const p of partes.slice(0, -1)) nodo = nodo[p] as Record<string, unknown>;
  if (valor === undefined) delete nodo[partes[partes.length - 1]];
  else nodo[partes[partes.length - 1]] = valor;
  return v;
}

describe("el ejemplo del contrato entra", () => {
  it("y traduce cada campo a donde va", () => {
    const r = parseLeadWon(valido());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sourceSystem).toBe("vulkan-lead-engine");
    expect(r.value.idempotencyKey).toBe(
      "vulkan-lead-engine:lead:018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00"
    );
    expect(r.value.orgId).toBeNull();
    expect(r.value.orgSlug).toBe("sueco-ab");
    expect(r.value.businessIndustry).toBe("Hair Salon");
    expect(r.value.location.city).toBe("Stockholm");
    expect(r.value.location.country).toBe("SE");
    expect(r.value.contact.display_name).toBe("Sueco AB");
  });

  it("la clave de idempotencia sale del CUERPO", () => {
    // La cabecera `x-vulkan-idempotency-key` NO está firmada; el cuerpo sí. Si
    // esto leyera la cabecera, cualquiera que toque la petición en tránsito
    // podría duplicar un cliente o hacer que una entrega verdadera se descarte.
    const r = parseLeadWon(valido());
    expect(r.ok && r.value.idempotencyKey.startsWith("vulkan-lead-engine:lead:")).toBe(true);
  });
});

describe("el evento", () => {
  it("sólo `lead.won`", () => {
    expect(EVENTO).toBe("lead.won");
    expect(parseLeadWon(con("event", "lead.lost"))).toEqual({ ok: false, campo: "event" });
    expect(parseLeadWon(con("event", undefined))).toEqual({ ok: false, campo: "event" });
  });
});

describe("adoptar el id del cliente, o acuñarlo", () => {
  it("un uuid se adopta", () => {
    const r = parseLeadWon(con("organization.org_id", "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22"));
    expect(r.ok && r.value.orgId).toBe("018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22");
  });

  it("null quiere decir acuñar", () => {
    expect(parseLeadWon(con("organization.org_id", null)).ok).toBe(true);
  });

  it("un uuid mal formado se RECHAZA, no se acuña uno en su lugar", () => {
    // Es el mismo id que usa Vulkan OS. Acuñar uno distinto rompería esa
    // igualdad en silencio y el síntoma aparecería una fase más adelante, en F5.
    expect(parseLeadWon(con("organization.org_id", "no-es-un-uuid"))).toEqual({
      ok: false,
      campo: "organization.org_id",
    });
    expect(parseLeadWon(con("organization.org_id", 42))).toEqual({
      ok: false,
      campo: "organization.org_id",
    });
  });
});

describe("los slugs cumplen el dominio canónico de la 0018", () => {
  it("acepta el del contrato", () => {
    expect(parseLeadWon(con("business.slug", "hudvard-goteborg-ab")).ok).toBe(true);
  });

  it("rechaza mayúsculas, acentos, guiones en los bordes y menos de tres", () => {
    for (const malo of ["Sueco-AB", "hudvård", "-sueco", "sueco-", "ab", ""]) {
      expect(parseLeadWon(con("business.slug", malo)), `slug ${JSON.stringify(malo)}`).toEqual({
        ok: false,
        campo: "business.slug",
      });
    }
  });

  it("también el de la organización", () => {
    expect(parseLeadWon(con("organization.slug", "Sueco AB"))).toEqual({
      ok: false,
      campo: "organization.slug",
    });
  });
});

describe("los opcionales viajan como cadena vacía, nunca como null", () => {
  it("ausente vale vacío", () => {
    const r = parseLeadWon(con("contact.phone", undefined));
    expect(r.ok && r.value.contact.phone).toBe("");
  });

  it("vacío vale vacío", () => {
    expect(parseLeadWon(con("contact.email", "")).ok).toBe(true);
  });

  it("null explícito se rechaza, y nombra el campo", () => {
    // Las columnas canónicas son `NOT NULL DEFAULT ''`. Un `null` donde el
    // contrato dice `""` es un productor que se apartó del contrato, y conviene
    // que se entere acá y no por un 500.
    expect(parseLeadWon(con("contact.phone", null))).toEqual({ ok: false, campo: "contact.phone" });
    expect(parseLeadWon(con("business.website", null))).toEqual({
      ok: false,
      campo: "business.website",
    });
  });
});

describe("el país", () => {
  it("acepta vacío y dos mayúsculas", () => {
    expect(parseLeadWon(con("locations.0.country", "")).ok).toBe(true);
    expect(parseLeadWon(con("locations.0.country", "SE")).ok).toBe(true);
  });

  it("rechaza las tres maneras de escribirlo mal", () => {
    // `se`, `SWE` y `Sweden` son tres formas del mismo país, y con la columna
    // libre las tres entran y ninguna junta con la otra.
    for (const malo of ["se", "SWE", "Sweden"]) {
      expect(parseLeadWon(con("locations.0.country", malo)), malo).toEqual({
        ok: false,
        campo: "locations[0].country",
      });
    }
  });
});

describe("locations es un arreglo de una entrada", () => {
  it("toma la primera", () => {
    const v = valido();
    (v.locations as unknown[]).push({ label: "Segunda", city: "Malmö", country: "SE" });
    const r = parseLeadWon(v);
    // Perder la segunda es mejor que perder el cliente entero: el plural es
    // headroom del receptor, no una promesa del productor.
    expect(r.ok && r.value.location.city).toBe("Stockholm");
  });

  it("rechaza el arreglo vacío y lo que no es arreglo", () => {
    expect(parseLeadWon(con("locations", []))).toEqual({ ok: false, campo: "locations" });
    expect(parseLeadWon(con("locations", {}))).toEqual({ ok: false, campo: "locations" });
    expect(parseLeadWon(con("locations", undefined))).toEqual({ ok: false, campo: "locations" });
  });
});

describe("lo que falta se nombra", () => {
  it("cada bloque obligatorio, por su nombre", () => {
    expect(parseLeadWon(con("source", undefined))).toEqual({ ok: false, campo: "source" });
    expect(parseLeadWon(con("source.system", ""))).toEqual({ ok: false, campo: "source.system" });
    expect(parseLeadWon(con("source.idempotency_key", ""))).toEqual({
      ok: false,
      campo: "source.idempotency_key",
    });
    expect(parseLeadWon(con("organization", undefined))).toEqual({
      ok: false,
      campo: "organization",
    });
    expect(parseLeadWon(con("business", undefined))).toEqual({ ok: false, campo: "business" });
    expect(parseLeadWon(con("contact", undefined))).toEqual({ ok: false, campo: "contact" });
  });

  it("un cuerpo que no es objeto", () => {
    for (const basura of [null, "texto", 42, []]) {
      expect(parseLeadWon(basura)).toEqual({ ok: false, campo: "body" });
    }
  });
});
