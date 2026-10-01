/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que los siete códigos del ensayo se lean como un solo «no se pudo».
 *
 * La mitad de las respuestas de `POST /api/publishing/rehearse` se arreglan en
 * lugares distintos —una aprobando en otra pantalla, una esperando un minuto,
 * una mirando la base, una tocando el código— y dos ni siquiera se distinguen
 * por el status. Un test que sólo mirara «devolvió algo» seguiría verde con las
 * diez frases fundidas en una, que es el defecto que este archivo persigue: por
 * eso la aserción central no es sobre una frase, es sobre que las frases sean
 * DISTINTAS entre sí.
 */
import { describe, expect, it } from "vitest";
import {
  CLASES_DE_ENSAYO,
  EL_ENSAYO_ESCRIBE,
  LECTURAS,
  SIN_APROBADOS,
  lecturaDeEnsayo,
  salioBien,
} from "../ensayoVisto";

describe("cómo se lee la respuesta de un ensayo", () => {
  it("200 con `ensayado` manda a mirar la fila nueva del ledger, no un id suelto", () => {
    // El defecto que impide: mostrar el `publicationId` y dejar que el operador
    // le crea al cartel en vez de al registro.
    const l = lecturaDeEnsayo(200, { ok: true, estado: "ensayado", publicationId: "p1" });
    expect(l.clase).toBe("ensayado");
    expect(l.queHacer).toMatch(/ledger/i);
    expect(l.quePaso).not.toContain("p1");
  });

  it("200 con `ya-publicado` tiene su propia frase, porque el ledger no cambia", () => {
    // El defecto que impide: con la fila ya en el ledger, un refresh no cambia
    // nada visible y sin frase propia el operador cree que el botón no hizo nada.
    const l = lecturaDeEnsayo(200, { ok: true, estado: "ya-publicado", publicationId: "p1", externalId: "gbp-9" });
    expect(l.clase).toBe("ya-publicado");
    expect(l.quePaso).not.toBe(LECTURAS.ensayado.quePaso);
  });

  it("un 200 con un estado que el dry-run no puede dar NO se lee como éxito", () => {
    // El defecto que impide: contestar `publicado` en modo ensayo y que la
    // pantalla lo celebre. Si el modo dejó de ser `dry-run`, eso es un defecto
    // del servidor, no una publicación.
    const l = lecturaDeEnsayo(200, { ok: true, estado: "publicado", publicationId: "p1", externalId: "gbp-9" });
    expect(l.clase).toBe("defecto-del-servidor");
  });

  it("404 dice que el asset no se alcanza y que NO se reservó nada", () => {
    // El defecto que impide: tragarse el 404 —el mismo que da la RLS para un
    // asset ajeno— y dejar a alguien esperando una fila que nunca se escribió.
    const l = lecturaDeEnsayo(404, { error: "not found" });
    expect(l.clase).toBe("asset-ausente");
    expect(l.quePaso).toMatch(/no se reservó/i);
  });

  it("409 manda a aprobar de nuevo, que es otra pantalla", () => {
    // El defecto que impide: decir «reintentá» cuando reintentar acá no puede
    // funcionar nunca; el sello se pone en /app/content.
    const l = lecturaDeEnsayo(409, { ok: false, motivo: "no-aprobado" });
    expect(l.clase).toBe("no-aprobado");
    expect(l.queHacer).toMatch(/\/app\/content/);
  });

  it("los dos caminos del 409 se leen igual, porque para el operador son lo mismo", () => {
    // `route.ts:90` (sin hash) y `route.ts:114` (hash viejo rechazado por la FK
    // de la 0016) llegan con el mismo cuerpo y se arreglan igual. Acá se afirma
    // que no se inventa una diferencia que el servidor no da.
    expect(lecturaDeEnsayo(409, { ok: false, motivo: "no-aprobado" })).toEqual(
      lecturaDeEnsayo(409, {})
    );
  });

  it("429 manda a esperar, no a revisar la base", () => {
    // El defecto que impide: «no se pudo (429)». El operador que apura el botón
    // se va a mirar el ledger por un límite de veinte por minuto.
    const l = lecturaDeEnsayo(429, { error: "too many requests" });
    expect(l.clase).toBe("demasiados");
    expect(l.queHacer).toMatch(/esperar/i);
  });

  it("401 dice que la sesión se cayó y que nada se escribió", () => {
    const l = lecturaDeEnsayo(401, { error: "not authenticated" });
    expect(l.clase).toBe("sin-sesion");
  });

  it("400 se lee como defecto de la pantalla, no como algo que reintentar", () => {
    const l = lecturaDeEnsayo(400, { error: "Request could not be processed." });
    expect(l.clase).toBe("pedido-invalido");
    expect(l.queHacer).not.toMatch(/reintentar\b/i);
  });

  it("502 CON motivo dice que no se sabe si quedó una fila", () => {
    // El caso más caro de fundir: `ledger-ilegible` significa que el ledger no
    // se pudo leer NI escribir, así que puede haber una reserva colgada.
    const l = lecturaDeEnsayo(502, { ok: false, motivo: "ledger-ilegible", detalle: "57P01" });
    expect(l.clase).toBe("ledger-ilegible");
    expect(l.quePaso).toMatch(/no se sabe/i);
  });

  it("502 SIN motivo dice que el ledger no se tocó, que es otro lugar donde mirar", () => {
    // `{ error: "asset unreadable" }`, `route.ts:86`. Mismo status, otro lugar:
    // fundirlos manda a mirar la base cuando no hay nada que mirar.
    const l = lecturaDeEnsayo(502, { error: "asset unreadable" });
    expect(l.clase).toBe("asset-ilegible");
    expect(l.quePaso).toMatch(/no se tocó/i);
    expect(l.quePaso).not.toBe(LECTURAS["ledger-ilegible"].quePaso);
  });

  it("500 no se reintenta: el modo dejó de ser el que la ruta cree", () => {
    const l = lecturaDeEnsayo(500, { ok: false, motivo: "sin-transporte" });
    expect(l.clase).toBe("defecto-del-servidor");
    expect(l.queHacer).toMatch(/no reintentar/i);
  });

  it("un status que nadie midió tampoco se lee como éxito", () => {
    // Anti-vacuidad del `else`: si mañana la ruta contesta 418, la pantalla no
    // puede dibujar un ensayo que no ocurrió.
    expect(lecturaDeEnsayo(418, {}).clase).toBe("defecto-del-servidor");
    expect(lecturaDeEnsayo(200, null).clase).toBe("defecto-del-servidor");
  });
});

describe("las frases, que son la garantía", () => {
  it("hay tantas frases DISTINTAS como clases: fundir dos pone esto rojo", () => {
    // Ésta es la aserción titular. Cada clase existe porque se arregla en un
    // lugar distinto; dos clases con el mismo texto son una clase de mentira, y
    // ningún test de status lo notaría.
    const frases = new Set(CLASES_DE_ENSAYO.map((c) => LECTURAS[c].quePaso));
    expect(frases.size).toBe(CLASES_DE_ENSAYO.length);
  });

  it("y ninguna frase está vacía ni repite el `queHacer` de otra clase distinta", () => {
    for (const clase of CLASES_DE_ENSAYO) {
      expect(LECTURAS[clase].clase, clase).toBe(clase);
      expect(LECTURAS[clase].quePaso.length, clase).toBeGreaterThan(20);
    }
    const queHacer = CLASES_DE_ENSAYO.map((c) => LECTURAS[c].queHacer);
    expect(new Set(queHacer).size).toBe(queHacer.length);
  });

  it("toda clase declarada es alcanzable desde alguna respuesta real", () => {
    // Anti-vacuidad al revés: una clase que ninguna respuesta produce es una
    // rama muerta, y la lista de clases dejaría de describir lo que pasa.
    const respuestas: [number, unknown][] = [
      [200, { estado: "ensayado" }],
      [200, { estado: "ya-publicado" }],
      [400, {}],
      [401, {}],
      [404, {}],
      [409, {}],
      [429, {}],
      [500, {}],
      // El 502 con la marca positiva de `route.ts:86` es el único que sabe que
      // el ledger quedó intacto; cualquier otro —incluido uno de un proxy— cae
      // en la incertidumbre.
      [502, { error: "asset unreadable" }],
      [502, {}],
      [502, { motivo: "ledger-ilegible" }],
    ];
    const alcanzadas = new Set(respuestas.map(([s, c]) => lecturaDeEnsayo(s, c).clase));
    // `sin-respuesta` no sale de ningún status: la produce el `catch` del
    // `fetch` en la pantalla, y quien la cubre es `client.test.tsx`. Se excluye
    // acá NOMBRÁNDOLA, para que una clase nueva sin respuesta que la produzca
    // siga cayendo.
    const sinStatus = new Set(["sin-respuesta"]);
    expect([...CLASES_DE_ENSAYO].filter((c) => !alcanzadas.has(c) && !sinStatus.has(c))).toEqual([]);
  });

  it("el estado vacío manda a aprobar, y el aviso dice que el ensayo ESCRIBE", () => {
    // Sin esto, el vacío se leería como «todavía nada» —y es el caso normal
    // hoy—, y el aviso es lo único que dice que un ensayo deja una fila que
    // desde acá no se puede borrar.
    expect(SIN_APROBADOS.quePaso).toMatch(/aprobado/i);
    expect(SIN_APROBADOS.queHacer).toMatch(/\/app\/content/);
    expect(EL_ENSAYO_ESCRIBE).toMatch(/reserva/i);
    expect(EL_ENSAYO_ESCRIBE).toMatch(/no publica/i);
  });
});

describe("qué cuenta como un ensayo que ocurrió", () => {
  it("sólo las dos clases que la base confirmó, y NINGUNA de las demás", () => {
    // Lo que decide si se refresca el ledger. Si un `defecto-del-servidor`
    // contara como éxito, la pantalla refrescaría y dibujaría un ensayo que no
    // ocurrió; si `ya-publicado` NO contara, se leería como un fallo.
    const bien = CLASES_DE_ENSAYO.filter(salioBien);
    expect(bien).toEqual(["ensayado", "ya-publicado"]);
  });
});
