/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la firma se verifique en un módulo que el endpoint no llama, y que la
 * ingesta se arme con cinco escrituras sueltas en vez de la función de la 0019.
 *
 * `signature.test.ts` y `payload.test.ts` prueban las decisiones. Lo que no
 * pueden probar es el CABLEADO: que la firma se mire ANTES del contenido, que un
 * payload roto no llegue a la base, y que la escritura sea UNA llamada por el
 * cliente de servicio. Es el defecto que este proyecto ya se comió dos veces —
 * treinta y un tests de un módulo que nadie invocaba.
 *
 * Por eso acá se afirma sobre QUÉ se llamó y en qué orden, no sólo sobre el
 * código de estado.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRETO = "no-es-un-secreto-real";

/** Cada llamada al RPC, con sus argumentos. Es lo que se afirma. */
let llamadas: { fn: string; args: Record<string, unknown> }[] = [];
/** Lo que el RPC contesta. Cada test lo define. */
let respuesta: { data: unknown; error: { message: string } | null } = {
  data: { organization_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22", duplicate: false },
  error: null,
};

const createSupabaseAdminClient = vi.fn(() => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    llamadas.push({ fn, args });
    return respuesta;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

/**
 * El cliente de SESIÓN no debe usarse acá, y un doble que explote es la forma de
 * afirmarlo: si el endpoint lo importara y lo llamara, el test cae con un
 * mensaje que dice exactamente qué pasó.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    throw new Error("el endpoint usó el cliente de SESIÓN para escribir");
  },
}));

function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

const PAYLOAD = {
  event: "lead.won",
  at: "2026-08-29T09:00:00.000Z",
  source: {
    system: "vulkan-lead-engine",
    lead_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
    organization_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1b11",
    idempotency_key: "vulkan-lead-engine:lead:018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
  },
  organization: { org_id: null, display_name: "Sueco AB", slug: "sueco-ab", default_locale: "sv" },
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
  contact: { display_name: "Sueco AB", email: "", phone: "", website: "", source: "" },
};

/** Un POST con el cuerpo crudo que se le pase, firmado o no. */
function pedido(raw: string, firma?: string | null, cabeceras: Record<string, string> = {}) {
  const h = new Headers({ "content-type": "application/json", ...cabeceras });
  if (firma !== null && firma !== undefined) h.set("x-vulkan-signature", firma);
  return new Request("https://growthos.test/api/webhooks/lead-won", {
    method: "POST",
    headers: h,
    body: raw,
  });
}

async function postear(raw: string, firma?: string | null, cabeceras?: Record<string, string>) {
  const { POST } = await import("@/app/api/webhooks/lead-won/route");
  const res = await POST(pedido(raw, firma, cabeceras));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  llamadas = [];
  respuesta = {
    data: { organization_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22", duplicate: false },
    error: null,
  };
  createSupabaseAdminClient.mockClear();
  process.env.GROWTH_OS_WEBHOOK_SECRET = SECRETO;
  vi.resetModules();
});

describe("la firma se mira ANTES que el contenido", () => {
  it("sin firma no se escribe nada, y el cuerpo ni se parsea", () => {
    const raw = "{ esto no es json";
    return postear(raw, null).then((r) => {
      expect(r.status).toBe(401);
      expect(llamadas).toHaveLength(0);
    });
  });

  it("con una firma que no corresponde, tampoco", async () => {
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw, "otro-secreto"));
    expect(r.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("sin el secreto de este lado se rechaza, no se acepta", async () => {
    // Un endpoint que acepta cuando le falta la configuración está abierto
    // durante el rato exacto en que alguien se olvidó una variable de entorno.
    delete process.env.GROWTH_OS_WEBHOOK_SECRET;
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(401);
    expect(llamadas).toHaveLength(0);
  });

  it("el motivo del rechazo NO viaja en la respuesta", async () => {
    // Decirle a quien prueba si le falló el formato, la firma, o si a este lado
    // le falta el secreto, es entregarle el mapa.
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, "sha256=zz");
    expect(JSON.stringify(r.body)).not.toMatch(/malformed|mismatch|no-secret|secret/i);
  });
});

describe("se firma el cuerpo CRUDO, no el reparseado", () => {
  it("un cuerpo con claves en orden raro y escapes verifica igual", async () => {
    // Si el endpoint reparseara antes de verificar, este cuerpo se rechazaría y
    // el síntoma sería «el productor manda firmas malas».
    const raw =
      '{"contact":{"display_name":"Hudv\\u00e5rd","email":"","phone":"","website":"","source":""},' +
      '"locations":[{"label":"Main","address_line":"","city":"G\\u00f6teborg","region":"","country":"SE","postal_code":""}],' +
      '"business":{"name":"Hudv\\u00e5rd AB","slug":"hudvard-ab","website":"","industry":"other"},' +
      '"organization":{"org_id":null,"display_name":"Hudv\\u00e5rd AB","slug":"hudvard-ab","default_locale":"sv"},' +
      '"source":{"system":"vulkan-lead-engine","idempotency_key":"vulkan-lead-engine:lead:abc"},' +
      '"event":"lead.won"}';
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);

    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(200);
    expect(llamadas).toHaveLength(1);
  });
});

describe("un payload firmado y roto no llega a la base", () => {
  it("devuelve 422 y nombra el campo", async () => {
    const roto = { ...PAYLOAD, business: { ...PAYLOAD.business, slug: "Sueco AB" } };
    const raw = JSON.stringify(roto);
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(422);
    expect(r.body.field).toBe("business.slug");
    expect(llamadas).toHaveLength(0);
  });

  it("un JSON inválido con firma buena también es 422, no 500", async () => {
    const raw = "{ no soy json";
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(422);
    expect(llamadas).toHaveLength(0);
  });
});

describe("la escritura es UNA llamada, por el cliente de servicio", () => {
  it("llama a ingest_lead_won con los doce argumentos traducidos", async () => {
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));

    expect(r.status).toBe(200);
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].fn).toBe("ingest_lead_won");
    expect(llamadas[0].args).toEqual({
      p_source_system: "vulkan-lead-engine",
      p_idempotency_key: "vulkan-lead-engine:lead:018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1a00",
      p_org_id: null,
      p_org_name: "Sueco AB",
      p_org_slug: "sueco-ab",
      p_org_locale: "sv",
      p_business_name: "Sueco AB",
      p_business_slug: "sueco-ab",
      p_business_website: "",
      p_business_industry: "Hair Salon",
      p_location: {
        label: "Main",
        address_line: "",
        city: "Stockholm",
        region: "",
        country: "SE",
        postal_code: "",
      },
      p_contact: {
        display_name: "Sueco AB",
        email: "",
        phone: "",
        website: "",
        source: "",
      },
    });
  });

  it("una sola llamada, no cinco escrituras sueltas", async () => {
    // La atomicidad la da la función de la 0019. Cinco llamadas serían cinco
    // transacciones y el reintento no podría volver atrás la organización
    // especulativa, que es todo el diseño.
    const raw = JSON.stringify(PAYLOAD);
    await postear(raw, firmar(raw));
    expect(llamadas).toHaveLength(1);
  });

  it("adopta el org_id cuando viene, en vez de mandar null", async () => {
    const conId = {
      ...PAYLOAD,
      organization: { ...PAYLOAD.organization, org_id: "018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22" },
    };
    const raw = JSON.stringify(conId);
    await postear(raw, firmar(raw));
    expect(llamadas[0].args.p_org_id).toBe("018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22");
  });
});

describe("qué contesta, y por qué ese código y no otro", () => {
  it("una entrega nueva es 200 con duplicate false", async () => {
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(200);
    expect(r.body.duplicate).toBe(false);
    expect(r.body.organization_id).toBe("018f3a1c-7b2e-7c31-9f4a-2b6d5e8c1c22");
  });

  it("un reintento es 200 con duplicate true, NO un error", async () => {
    // Un 409 sería tentador y sería peor: le diría al productor que algo salió
    // mal cuando lo que pasó es que la restricción funcionó.
    respuesta = { data: { organization_id: null, duplicate: true }, error: null };
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(200);
    expect(r.body.duplicate).toBe(true);
  });

  it("un fallo de la base es 500, que es lo único que puede andar la próxima", async () => {
    respuesta = { data: null, error: { message: "connection reset" } };
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));
    expect(r.status).toBe(500);
  });

  it("el mensaje de la base no se le devuelve a quien llama", async () => {
    respuesta = { data: null, error: { message: 'relation "contacts" does not exist' } };
    const raw = JSON.stringify(PAYLOAD);
    const r = await postear(raw, firmar(raw));
    expect(JSON.stringify(r.body)).not.toMatch(/relation|contacts|does not exist/);
  });
});
