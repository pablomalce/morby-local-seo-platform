/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que un estado que la ficha no sabe pintar se le muestre al cliente como
 * "NOT CONNECTED".
 *
 * El mapa de colores y textos vivía dentro de `DataSourceRow`, en
 * `ReportView.tsx`, y su fallback era `missing`. O sea: cualquier cosa que ese
 * mapa no reconociera —un estado nuevo, un valor que llega de la base, un typo—
 * se presentaba como una integración que falta conectar. El mismo defecto de
 * clase que el resto del frente, una capa más arriba, y sin ningún test que lo
 * alcanzara porque estaba dentro de un componente.
 */
import { describe, expect, it } from "vitest";

import {
  DATA_SOURCE_KEYS,
  DATA_SOURCE_LABELS,
  DATA_SOURCE_STATUS_DISPLAY,
  displayForStatus,
  labelForSource,
} from "@/lib/reports/dataSources";

describe("displayForStatus — lo desconocido se lee como problema", () => {
  it("un estado desconocido cae en ERROR, no en NOT CONNECTED", () => {
    expect(displayForStatus("cualquier-cosa")).toBe(DATA_SOURCE_STATUS_DISPLAY.error);
    expect(displayForStatus("cualquier-cosa").text).not.toBe(
      DATA_SOURCE_STATUS_DISPLAY.missing.text,
    );
  });

  it("una cadena vacía tampoco se lee como 'sin conectar'", () => {
    // El caso que llega solo: un campo que la base devuelve vacío.
    expect(displayForStatus("").text).toBe(DATA_SOURCE_STATUS_DISPLAY.error.text);
  });

  it("los cuatro estados conocidos se pintan cada uno distinto", () => {
    const textos = new Set(
      (["live", "demo", "missing", "error"] as const).map((s) => displayForStatus(s).text),
    );
    // Si dos coinciden, la ficha deja de distinguir dos situaciones que exigen
    // acciones opuestas.
    expect(textos.size).toBe(4);
  });

  it("error y missing no comparten color", () => {
    expect(DATA_SOURCE_STATUS_DISPLAY.error.color).not.toBe(
      DATA_SOURCE_STATUS_DISPLAY.missing.color,
    );
  });
});

describe("los nombres de las fuentes", () => {
  it("cada fuente tiene un nombre, y ninguno es su clave", () => {
    for (const key of DATA_SOURCE_KEYS) {
      const label = labelForSource(key);
      expect(label, `${key} sin nombre`).toBeTruthy();
      expect(label, `${key} se nombra con su clave`).not.toBe(key);
    }
  });

  it("no hay dos fuentes con el mismo nombre", () => {
    // Dos nombres iguales harían imposible saber cuál falló.
    const nombres = new Set(DATA_SOURCE_KEYS.map((k) => DATA_SOURCE_LABELS[k]));
    expect(nombres.size).toBe(DATA_SOURCE_KEYS.length);
  });
});
