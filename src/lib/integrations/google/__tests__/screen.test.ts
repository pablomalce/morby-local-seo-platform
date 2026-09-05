/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la pantalla mande a un operador a configurar un cliente que ya está bien.
 *
 * El reporte tiene cuatro palabras y por debajo hay más de cuatro situaciones.
 * Dos de ellas comparten estado y se arreglan en lugares distintos: «la
 * plataforma no está conectada» una vez, en Google Cloud, y «este cliente no
 * está mapeado» por cliente, en esta pantalla. Que el estado sea el mismo es
 * aceptable; que la RAZÓN se pierda no, porque es lo único que dice adónde ir.
 *
 * Y el mapeo tiene que verse aunque el estado sea otro. Una pantalla que existe
 * para editar el mapeo y lo esconde cuando algo más anda mal esconde el dato
 * justo cuando hace falta mirarlo.
 */
import { describe, expect, it } from "vitest";
import {
  GOOGLE_SURFACES,
  type AgencyTokenState,
  viewForOrganization,
  viewForSurface,
} from "@/lib/integrations/google/screen";
import type { PropertyMapping } from "@/lib/integrations/google/sources";

const CONECTADA = {
  GOOGLE_CLIENT_ID: "no-es-un-client-id-real.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "no-es-un-secreto-real",
} as unknown as NodeJS.ProcessEnv;

const SIN_CREDENCIALES = {} as unknown as NodeJS.ProcessEnv;

const MAPEO_COMPLETO: PropertyMapping[] = [
  { provider: "ga4", propertyRef: "properties/123456789" },
  { provider: "search_console", propertyRef: "https://ejemplo.com/" },
  { provider: "google_business_profile", propertyRef: "locations/123456789" },
];

/** Los siete estados del token, para recorrerlos donde el resultado no depende de ellos. */
const TODOS_LOS_TOKENS: AgencyTokenState[] = [
  "active",
  "expired",
  "revoked",
  "absent",
  "unset",
  "malformed",
  "unreadable",
];

describe("sin credenciales de plataforma, gana esa causa", () => {
  it("dice «sin conectar» y nombra la plataforma, no al cliente", () => {
    const v = viewForSurface("ga4", MAPEO_COMPLETO, "active", SIN_CREDENCIALES);
    expect(v.state).toBe("not-connected");
    expect(v.reason).toBe("platform-not-connected");
  });

  it("gana sobre cualquier estado del token, porque sin credenciales no hay token de nadie", () => {
    for (const token of TODOS_LOS_TOKENS) {
      const v = viewForSurface("ga4", MAPEO_COMPLETO, token, SIN_CREDENCIALES);
      expect(v.reason, `con el token ${token}`).toBe("platform-not-connected");
    }
  });

  it("muestra el mapeo igual", () => {
    // La pantalla existe para editarlo. Esconderlo porque falta lo de arriba
    // deja al operador sin ver lo único que él puede arreglar.
    const v = viewForSurface("ga4", MAPEO_COMPLETO, "active", SIN_CREDENCIALES);
    expect(v.propertyRef).toBe("properties/123456789");
  });
});

describe("con la plataforma conectada y el estado del token sin averiguar", () => {
  // Los tres dicen «no pudimos mirar», no «no hay conexión». El token puede
  // estar vivo, y mostrarlos como «sin conectar» manda a rehacer un OAuth que
  // ya está hecho — la respuesta correcta por el motivo equivocado, que es el
  // defecto que este módulo existe para impedir.
  const SIN_AVERIGUAR: [AgencyTokenState, string][] = [
    ["unset", "agency-organization-unset"],
    ["malformed", "agency-organization-malformed"],
    ["unreadable", "agency-token-unreadable"],
  ];

  it("los tres son `error`, y cada uno nombra su propio arreglo", () => {
    for (const [token, razon] of SIN_AVERIGUAR) {
      const v = viewForSurface("ga4", MAPEO_COMPLETO, token, CONECTADA);
      expect(v.state, `con el token ${token}`).toBe("error");
      expect(v.reason, `con el token ${token}`).toBe(razon);
    }
  });

  it("las tres razones son distintas entre sí, porque se arreglan en lugares distintos", () => {
    // Colapsarlas en una sola diría «revisá la configuración» sin decir cuál, y
    // corregir un uuid mal escrito no se parece en nada a investigar por qué
    // falló una consulta.
    const razones = SIN_AVERIGUAR.map(
      ([token]) => viewForSurface("ga4", MAPEO_COMPLETO, token, CONECTADA).reason
    );
    expect(new Set(razones).size).toBe(3);
  });

  it("ganan sobre que el cliente no esté mapeado", () => {
    for (const [token, razon] of SIN_AVERIGUAR) {
      const v = viewForSurface("ga4", [], token, CONECTADA);
      expect(v.reason, `con el token ${token}`).toBe(razon);
    }
  });
});

describe("los estados del token de la agencia", () => {
  it("revocado es «sin conectar», y nombra que es de la plataforma", () => {
    const v = viewForSurface("ga4", MAPEO_COMPLETO, "revoked", CONECTADA);
    expect(v.state).toBe("not-connected");
    expect(v.reason).toBe("platform-token-revoked");
  });

  it("ausente es «sin conectar», y NO se confunde con revocado", () => {
    // Los dos terminan en el mismo botón y no dicen lo mismo: revocado es que
    // hubo autorización y se cayó, ausente es que nunca se hizo. Quien lee la
    // pantalla busca cosas distintas según cuál sea.
    const v = viewForSurface("ga4", MAPEO_COMPLETO, "absent", CONECTADA);
    expect(v.state).toBe("not-connected");
    expect(v.reason).toBe("platform-token-absent");
    expect(v.reason).not.toBe("platform-token-revoked");
  });

  it("ausente NO es `error`: la consulta salió bien y la respuesta fue que no hay token", () => {
    // Es lo que lo separa de `unreadable`, que es el caso en que no sabemos.
    expect(viewForSurface("ga4", MAPEO_COMPLETO, "absent", CONECTADA).state).not.toBe("error");
  });

  it("vencido se ve IGUAL que activo: no es un estado de la superficie", () => {
    // Este test decía «vencido tiene palabra propia, porque tiene arreglo
    // propio». La segunda mitad era cierta y la primera hacía daño: pintaba las
    // tres superficies de naranja con `EXPIRED`, que se lee como que la conexión
    // de este cliente está rota.
    //
    // Medido en producción el 2026-09-05, con el estado en `expired`: Search
    // Console, GA4 y PageSpeed contestaron las tres `ok` en la misma corrida y
    // el reporte salió con datos reales del cliente. La palabra describía una
    // resta de fechas, no el estado de la conexión.
    //
    // Lo que la reemplaza es la sonda, que esta misma pantalla ya dibuja al
    // lado: si el refresh estuviera muerto, la llamada falla y
    // `integration_probe` lo anota por fuente, con su motivo y hace cuánto.
    const vencido = viewForSurface("ga4", MAPEO_COMPLETO, "expired", CONECTADA);
    const activo = viewForSurface("ga4", MAPEO_COMPLETO, "active", CONECTADA);
    expect(vencido).toEqual(activo);
    expect(vencido.state).toBe("connected");
    expect(vencido.reason).toBeNull();
  });

  it("y sin mapeo, vencido tampoco tapa lo que de verdad falta", () => {
    // La otra mitad: que «se ve igual que activo» no signifique «se ve bien
    // siempre». Un cliente sin property tiene que seguir diciendo que le falta
    // la property, con el token vencido o sin él.
    const v = viewForSurface("ga4", [], "expired", CONECTADA);
    expect(v.state).toBe("not-connected");
    expect(v.reason).toBe("client-not-mapped");
  });

  it("revocado domina sobre vencido, igual que en la 0014", () => {
    // Un token revocado también está vencido tarde o temprano, y el arreglo no
    // es el mismo. `integration_token_state()` ya resuelve esa precedencia; acá
    // se comprueba que la pantalla no la invierta.
    expect(viewForSurface("ga4", MAPEO_COMPLETO, "revoked", CONECTADA).state).toBe("not-connected");
  });

  it("con el token entero y el cliente mapeado, dice «conectado»", () => {
    const v = viewForSurface("ga4", MAPEO_COMPLETO, "active", CONECTADA);
    expect(v.state).toBe("connected");
    expect(v.propertyRef).toBe("properties/123456789");
  });

  it("los seis estados rotos muestran el mapeo igual", () => {
    for (const token of [
      "expired",
      "revoked",
      "absent",
      "unset",
      "malformed",
      "unreadable",
    ] as AgencyTokenState[]) {
      const v = viewForSurface("search_console", MAPEO_COMPLETO, token, CONECTADA);
      expect(v.propertyRef, `con el token ${token}`).toBe("https://ejemplo.com/");
    }
  });
});

describe("la razón que se arregla en esta pantalla", () => {
  it("con todo lo de arriba en orden, dice que falta el mapeo DE ESTE CLIENTE", () => {
    const v = viewForSurface("ga4", [], "active", CONECTADA);
    expect(v.state).toBe("not-connected");
    expect(v.reason).toBe("client-not-mapped");
    expect(v.propertyRef).toBeNull();
  });

  it("no se confunde con la razón de plataforma, que se arregla en otro lado", () => {
    const sinPlataforma = viewForSurface("ga4", [], "active", SIN_CREDENCIALES);
    const sinMapeo = viewForSurface("ga4", [], "active", CONECTADA);
    // Mismo estado, dos razones. Ésa es toda la diferencia entre mandar a Google
    // Cloud y mandar al campo de abajo.
    expect(sinPlataforma.state).toBe(sinMapeo.state);
    expect(sinPlataforma.reason).not.toBe(sinMapeo.reason);
  });

  it("cada superficie se mapea por separado", () => {
    // A mitad de un onboarding esto es lo normal, y es donde un «hay mapeos»
    // daría las tres por listas.
    const soloGa4: PropertyMapping[] = [{ provider: "ga4", propertyRef: "properties/123456789" }];
    expect(viewForSurface("ga4", soloGa4, "active", CONECTADA).state).toBe("connected");
    expect(viewForSurface("search_console", soloGa4, "active", CONECTADA).reason).toBe(
      "client-not-mapped"
    );
    expect(viewForSurface("google_business_profile", soloGa4, "active", CONECTADA).reason).toBe(
      "client-not-mapped"
    );
  });
});

describe("la invariante que hace legible la pantalla", () => {
  it("la razón es nula EXACTAMENTE cuando el estado es «conectado»", () => {
    // Sin esto, un estado roto sin razón deja al operador sin saber adónde ir, y
    // «conectado» con una razón al lado lo manda a arreglar lo que anda.
    const mapeos: PropertyMapping[][] = [[], MAPEO_COMPLETO];
    const entornos = [SIN_CREDENCIALES, CONECTADA];
    let conectados = 0;
    for (const surface of GOOGLE_SURFACES) {
      for (const m of mapeos) {
        for (const env of entornos) {
          for (const token of TODOS_LOS_TOKENS) {
            const v = viewForSurface(surface, m, token, env);
            if (v.state === "connected") {
              conectados += 1;
              expect(v.reason, `${surface}/${token}`).toBeNull();
            } else {
              expect(v.reason, `${surface}/${token}`).not.toBeNull();
            }
          }
        }
      }
    }
    // Anti-vacuidad: si ninguna combinación llega a «conectado», el bucle de
    // arriba no probó la mitad que importa y pasa igual.
    //
    // SEIS y no tres: tres superficies por los DOS estados de token que ahora
    // llegan a «conectado», `active` y `expired`. Decía tres cuando `expired`
    // tenía estado propio. El número está escrito a mano a propósito — si otro
    // estado empezara a contar como conectado, esta línea tiene que ponerse en
    // rojo y obligar a decidirlo, en vez de absorberlo en silencio.
    expect(conectados).toBe(6);
  });
});

describe("la organización entera", () => {
  it("devuelve las tres superficies, en el orden de la pantalla", () => {
    const vistas = viewForOrganization(MAPEO_COMPLETO, "active", CONECTADA);
    expect(vistas.map((v) => v.surface)).toEqual([
      "search_console",
      "ga4",
      "google_business_profile",
    ]);
  });

  it("una organización sin ningún mapeo devuelve las tres igual", () => {
    // Si devolviera sólo las mapeadas, la pantalla no tendría dónde mapear las
    // que faltan — que es el caso de todo cliente nuevo.
    const vistas = viewForOrganization([], "active", CONECTADA);
    expect(vistas).toHaveLength(3);
    expect(vistas.every((v) => v.reason === "client-not-mapped")).toBe(true);
  });
});
