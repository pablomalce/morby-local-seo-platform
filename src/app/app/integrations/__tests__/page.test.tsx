/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla exista y no le pregunte nada a la base.
 *
 * `screen.test.ts` prueba la decisión: qué estado y qué razón corresponden a
 * cada combinación. Lo que NO puede probar es que la pantalla la use. Es el
 * defecto que este proyecto ya se comió dos veces: treinta y un tests de un
 * módulo que nadie invocaba, todos en verde — y un `"missing"` escrito a mano
 * al lado de un resolvedor perfecto.
 *
 * Por eso lo que se afirma acá es el CABLEADO: qué consulta se hizo, con qué
 * filtros, y que lo que llega al componente de abajo sale de esas filas y no de
 * una constante. Un test que sólo mirara «hay tres superficies» pasaría con las
 * tres clavadas en el archivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const redirect = vi.fn((destino: string) => {
  throw new Error(`redirect:${destino}`);
});
vi.mock("next/navigation", () => ({ redirect }));

let usuario: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
let membresias: { organization_id: string }[] = [];
let organizaciones: { id: string; name: string; slug: string }[] = [];
let mapeos: { organization_id: string; provider: string; property_ref: string }[] = [];

/** Cada consulta, con su tabla y sus filtros. Es lo que se afirma. */
let consultas: { tabla: string; filtros: Record<string, unknown> }[] = [];

const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";

const createSupabaseServerClient = vi.fn(async () => ({
  auth: { getUser: async () => ({ data: { user: usuario } }) },
  from(tabla: string) {
    const filtros: Record<string, unknown> = {};
    const registrar = () => consultas.push({ tabla, filtros: { ...filtros } });

    const datos = () => {
      if (tabla === "org_members") return membresias;
      if (tabla === "organizations") return organizaciones;
      if (tabla === "integration_properties") return mapeos;
      return [];
    };

    // Encadenable y ESPERABLE a la vez: `organizations` termina en `.in()` y
    // `integration_properties` sigue con `.is()` después. Un doble que devuelva
    // la promesa en `.in()` corta la segunda cadena, que es lo que pasó al
    // escribir este archivo.
    const encadenable: Record<string, unknown> = {
      select: () => encadenable,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return encadenable;
      },
      in: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return encadenable;
      },
      is: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return encadenable;
      },
      then: (resolver: (v: unknown) => unknown) =>
        Promise.resolve({ data: datos(), error: null }).then(resolver),
    };
    return encadenable;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

/** La organización de Vulkan, la que `VULKAN_AGENCY_ORG_ID` nombra. */
const AGENCIA = "44444444-4444-4444-8444-444444444444";

/**
 * El token de la agencia, y si la consulta o la clasificación fallan.
 *
 * Se mockea `@/lib/supabase/admin` y no `agencyToken.ts` a propósito: mockear
 * el módulo entero probaría que la pantalla llama a una función, no que esa
 * función le pregunte a la base por la organización correcta. El cableado que
 * este archivo mide llega hasta la consulta.
 */
let filaDelToken: { expires_at: string; revoked_at: string | null } | null = null;
let falloDeLectura = false;
let clasificacion: string | null = "active";

const createSupabaseAdminClient = vi.fn(() => ({
  from(tabla: string) {
    const filtros: Record<string, unknown> = {};
    const registrar = () => consultas.push({ tabla, filtros: { ...filtros } });
    const encadenable: Record<string, unknown> = {
      select: () => encadenable,
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        registrar();
        return encadenable;
      },
      order: (col: string, opts: unknown) => {
        filtros[`order:${col}`] = opts;
        registrar();
        return encadenable;
      },
      limit: (n: number) => {
        filtros.limit = n;
        registrar();
        return encadenable;
      },
      then: (resolver: (v: unknown) => unknown) =>
        Promise.resolve(
          falloDeLectura
            ? { data: null, error: { message: "falló" } }
            : { data: filaDelToken ? [filaDelToken] : [], error: null }
        ).then(resolver),
    };
    return encadenable;
  },
  rpc: async (nombre: string, args: Record<string, unknown>) => {
    consultas.push({ tabla: `rpc:${nombre}`, filtros: { ...args } });
    return { data: clasificacion, error: null };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

/** Todos los nodos del árbol devuelto cuyo componente se llama `nombre`. */
function nodos(raiz: unknown, nombre: string): { props: Record<string, unknown> }[] {
  const encontrados: { props: Record<string, unknown> }[] = [];
  const visitar = (nodo: unknown): void => {
    if (Array.isArray(nodo)) {
      nodo.forEach(visitar);
      return;
    }
    if (!nodo || typeof nodo !== "object") return;
    const el = nodo as ReactElement & { props?: Record<string, unknown> };
    const tipo = el.type as unknown;
    if (typeof tipo === "function" && (tipo as { name?: string }).name === nombre) {
      encontrados.push({ props: (el.props ?? {}) as Record<string, unknown> });
    }
    if (el.props) Object.values(el.props).forEach(visitar);
  };
  visitar(raiz);
  return encontrados;
}

async function pantalla() {
  const mod = await import("@/app/app/integrations/page");
  return mod.default();
}

/**
 * La ÚLTIMA consulta al mapeo, no la primera.
 *
 * Cada filtro registra una entrada, así que la primera trae la cadena a medio
 * armar. Afirmar sobre ella daría por buena una consulta sin
 * `unmapped_at IS NULL`, que es justamente el filtro que hay que comprobar.
 */
const consultaAlMapeo = () => {
  const todas = consultas.filter((c) => c.tabla === "integration_properties");
  return todas.length ? todas[todas.length - 1] : undefined;
};

beforeEach(() => {
  usuario = { id: "11111111-1111-4111-8111-111111111111" };
  membresias = [{ organization_id: ORG_A }];
  organizaciones = [{ id: ORG_A, name: "Cliente A", slug: "cliente-a" }];
  mapeos = [];
  consultas = [];
  redirect.mockClear();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  process.env.VULKAN_AGENCY_ORG_ID = AGENCIA;
  filaDelToken = null;
  falloDeLectura = false;
  clasificacion = "active";
  vi.resetModules();
});

describe("el cableado con la base", () => {
  it("pide los mapeos VIVOS de las organizaciones del usuario", async () => {
    await pantalla();

    const c = consultaAlMapeo();
    expect(c, "no se consultó integration_properties").toBeDefined();
    expect(c!.filtros.organization_id).toEqual([ORG_A]);
    // Los desmapeados son registro, no configuración: mostrar uno muerto le
    // atribuye a un cliente una property que ya no es suya.
    expect(c!.filtros.unmapped_at).toBeNull();
  });

  it("no le pregunta a nadie cuando el usuario no tiene organizaciones", async () => {
    // Una consulta con la lista vacía es una consulta por tenant nulo contra
    // una tabla cuyo eje es el tenant.
    membresias = [];
    organizaciones = [];
    await pantalla();
    expect(consultaAlMapeo()).toBeUndefined();
  });

  it("sin sesión manda al login y no consulta nada", async () => {
    usuario = null;
    await expect(pantalla()).rejects.toThrow("redirect:/login?redirectTo=/app/integrations");
    expect(consultas.filter((c) => c.tabla !== "org_members")).toHaveLength(0);
  });
});

describe("lo que llega a la pantalla sale de esas filas", () => {
  it("el mapeo de la base aparece en la superficie que le corresponde", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    mapeos = [{ organization_id: ORG_A, provider: "ga4", property_ref: "properties/123456789" }];

    const arbol = await pantalla();
    const bloques = nodos(arbol, "OrganizationIntegrations");
    expect(bloques).toHaveLength(1);

    const superficies = bloques[0].props.surfaces as { surface: string; propertyRef: string | null }[];
    expect(superficies.find((s) => s.surface === "ga4")!.propertyRef).toBe("properties/123456789");
    expect(superficies.find((s) => s.surface === "search_console")!.propertyRef).toBeNull();
  });

  it("cada organización recibe SUS mapeos y no los de la otra", async () => {
    // Con un token de agencia esto es la frontera entre clientes: mezclar dos
    // organizaciones acá es mostrarle a una la property de la otra, que es el
    // primer paso de pedirle a Google los números ajenos.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    membresias = [{ organization_id: ORG_A }, { organization_id: ORG_B }];
    organizaciones = [
      { id: ORG_A, name: "Cliente A", slug: "cliente-a" },
      { id: ORG_B, name: "Cliente B", slug: "cliente-b" },
    ];
    mapeos = [
      { organization_id: ORG_A, provider: "ga4", property_ref: "properties/111" },
      { organization_id: ORG_B, provider: "ga4", property_ref: "properties/222" },
    ];

    const bloques = nodos(await pantalla(), "OrganizationIntegrations");
    expect(bloques).toHaveLength(2);

    const refDe = (i: number) =>
      (bloques[i].props.surfaces as { surface: string; propertyRef: string | null }[]).find(
        (s) => s.surface === "ga4"
      )!.propertyRef;

    expect(bloques[0].props.organizationId).toBe(ORG_A);
    expect(refDe(0)).toBe("properties/111");
    expect(bloques[1].props.organizationId).toBe(ORG_B);
    expect(refDe(1)).toBe("properties/222");
  });

  it("el estado lo decide el resolvedor, no la pantalla", async () => {
    // Sin credenciales de plataforma la razón tiene que ser la de plataforma,
    // aunque el cliente esté mapeado. Si la pantalla clavara los estados, esto
    // diría «sin mapear» o «conectado» según qué constante hubiera quedado.
    mapeos = [{ organization_id: ORG_A, provider: "ga4", property_ref: "properties/123456789" }];

    const bloques = nodos(await pantalla(), "OrganizationIntegrations");
    const ga4 = (bloques[0].props.surfaces as { surface: string; reason: string }[]).find(
      (s) => s.surface === "ga4"
    )!;
    expect(ga4.reason).toBe("platform-not-connected");
  });

  it("con credenciales, agencia y token vivo, la superficie mapeada queda conectada", async () => {
    // La versión anterior de este test esperaba `agency-organization-undecided`
    // y decía que cambiarlo sería la señal de que la costura se usó. Esto es esa
    // señal: la decisión existe, el estado sale de la base, y lo único que
    // queda decidiendo por cliente es el mapeo.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    filaDelToken = { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null };
    clasificacion = "active";
    mapeos = [{ organization_id: ORG_A, provider: "ga4", property_ref: "properties/123456789" }];

    const bloques = nodos(await pantalla(), "OrganizationIntegrations");
    const ga4 = (bloques[0].props.surfaces as { surface: string; state: string; reason: string }[]).find(
      (s) => s.surface === "ga4"
    )!;
    expect(ga4.state).toBe("connected");
    expect(ga4.reason).toBe(null);
  });

  it("y sin la variable de la agencia, esa misma superficie es `error` y no «conectada»", async () => {
    // El par del anterior: lo único que cambia entre los dos es saber a quién
    // preguntarle. Sin eso, afirmar «conectado» sería afirmar algo que nadie
    // midió.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    delete process.env.VULKAN_AGENCY_ORG_ID;
    mapeos = [{ organization_id: ORG_A, provider: "ga4", property_ref: "properties/123456789" }];

    const bloques = nodos(await pantalla(), "OrganizationIntegrations");
    const ga4 = (bloques[0].props.surfaces as { surface: string; state: string; reason: string }[]).find(
      (s) => s.surface === "ga4"
    )!;
    expect(ga4.state).toBe("error");
    expect(ga4.reason).toBe("agency-organization-unset");
  });

  it("una organización sin ningún mapeo igual muestra las tres superficies", async () => {
    // Es el caso de todo cliente nuevo, y es donde hace falta el formulario.
    const bloques = nodos(await pantalla(), "OrganizationIntegrations");
    expect((bloques[0].props.surfaces as unknown[]).length).toBe(3);
  });
});

describe("el estado de la plataforma se muestra medido, no supuesto", () => {
  it("sin las dos credenciales dice que no está conectada", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    const aviso = nodos(await pantalla(), "PlatformNotice");
    expect(aviso).toHaveLength(1);
    // Media credencial no completa ningún intercambio OAuth.
    expect(aviso[0].props.connected).toBe(false);
  });

  it("con las dos, dice que está", async () => {
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    const aviso = nodos(await pantalla(), "PlatformNotice");
    expect(aviso[0].props.connected).toBe(true);
  });

  it("le pregunta a la base por el token de LA AGENCIA, no por el del cliente", async () => {
    // La consulta por la organización del cliente es el modelo viejo: esa fila
    // no existe para ningún cliente, así que todos dirían «sin token» para
    // siempre — la respuesta correcta por el motivo equivocado.
    await pantalla();

    const c = consultas.filter((q) => q.tabla === "integration_tokens").pop();
    expect(c, "no se consultó integration_tokens").toBeDefined();
    expect(c!.filtros.organization_id).toBe(AGENCIA);
    expect(c!.filtros.organization_id).not.toBe(ORG_A);
    expect(c!.filtros.provider).toBe("google");
  });

  it("pide la fila viva primero, porque el índice único de la 0014 es parcial", async () => {
    // Una organización puede tener varias revocadas y una viva. Sin este orden,
    // un `limit 1` podría traer una revocada de hace meses y declarar revocado
    // un token que anda.
    await pantalla();

    const c = consultas.filter((q) => q.tabla === "integration_tokens").pop();
    expect(c!.filtros["order:revoked_at"]).toEqual({ ascending: true, nullsFirst: true });
  });

  it("sin fila, el estado que llega a la pantalla es `absent`", async () => {
    filaDelToken = null;
    const aviso = nodos(await pantalla(), "PlatformNotice");
    expect(aviso[0].props.tokenState).toBe("absent");
  });

  it("con fila, el estado sale de la función de la base y no de la pantalla", async () => {
    filaDelToken = { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null };
    clasificacion = "expired";
    const aviso = nodos(await pantalla(), "PlatformNotice");
    // La pantalla no mira `expires_at`: si lo hiciera, esta fila que vence en
    // 2099 diría «activo» y la respuesta de la base quedaría ignorada.
    expect(aviso[0].props.tokenState).toBe("expired");
    expect(consultas.some((q) => q.tabla === "rpc:integration_token_state")).toBe(true);
  });

  it("una lectura que falla llega como `unreadable`, no como «sin token»", async () => {
    falloDeLectura = true;
    const aviso = nodos(await pantalla(), "PlatformNotice");
    expect(aviso[0].props.tokenState).toBe("unreadable");
  });

  it("sin `VULKAN_AGENCY_ORG_ID` llega `unset`, y no se consulta la tabla", async () => {
    delete process.env.VULKAN_AGENCY_ORG_ID;
    const aviso = nodos(await pantalla(), "PlatformNotice");
    expect(aviso[0].props.tokenState).toBe("unset");
    expect(consultas.some((q) => q.tabla === "integration_tokens")).toBe(false);
  });

  it("el mismo estado va al aviso y a cada organización, porque el token es uno solo", async () => {
    // Dos fuentes para el mismo dato es como se separan. El token es de la
    // plataforma: si el aviso dijera una cosa y las tarjetas otra, una de las
    // dos estaría mintiendo.
    process.env.GOOGLE_CLIENT_ID = "no-es-real.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "no-es-real";
    organizaciones = [
      { id: ORG_A, name: "Cliente A", slug: "cliente-a" },
      { id: ORG_B, name: "Cliente B", slug: "cliente-b" },
    ];
    membresias = [{ organization_id: ORG_A }, { organization_id: ORG_B }];
    filaDelToken = { expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null };
    clasificacion = "revoked";

    const arbol = await pantalla();
    const aviso = nodos(arbol, "PlatformNotice");
    const tarjetas = nodos(arbol, "OrganizationIntegrations");

    expect(aviso[0].props.tokenState).toBe("revoked");
    expect(tarjetas).toHaveLength(2);
    for (const t of tarjetas) {
      const superficies = t.props.surfaces as { reason: string | null }[];
      for (const s of superficies) {
        expect(s.reason).toBe("platform-token-revoked");
      }
    }
  });
});
