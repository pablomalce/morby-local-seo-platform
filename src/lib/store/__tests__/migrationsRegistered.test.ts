import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every migration records itself in `schema_migrations`.
 *
 * The hole this closes. Nothing in this repository applies
 * `supabase/migrations/` to the hosted database — not CI, which applies them to
 * a throwaway PostgreSQL so the assertions have a schema; not Vercel; not a
 * script. A person applies them. And for a while nobody could tell which ones
 * that person had applied: `0006` sat merged and green in CI while
 * `tpqiltnskfeycnybczgz` did not have it, and the only way that surfaced was
 * diffing catalogues with `schema_fingerprint.sql` and reasoning backwards from
 * the difference.
 *
 * `0008` adds the table that answers the question directly. This test is what
 * keeps it answering: a migration that does not register itself makes the table
 * lie by omission, and that is worse than having no table, because now the
 * answer looks authoritative.
 *
 * Static, and it has to be: the failure it prevents happens on a database this
 * suite never connects to.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/** `0007_explicit_function_grants.sql` → `0007_explicit_function_grants` */
function version(file: string): string {
  return file.replace(/\.sql$/, "");
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * The migration that introduced the table backfills the ones before it, so
 * those are registered there rather than in themselves. Everything from here on
 * registers itself.
 */
const REGISTRY_MIGRATION = "0008_schema_migrations";

/**
 * NÚMEROS RESERVADOS POR UN PR ABIERTO, CON SU DUEÑO ESCRITO.
 *
 * Dos frentes pueden escribir migraciones a la vez, y el número se reparte
 * antes de mergear para que el orden de aplicación lo decida el NOMBRE y no
 * quién llegó primero. Hasta que el dueño del número mergea, la rama que tomó
 * el siguiente tiene un hueco, y el hueco es exactamente lo que el test de
 * abajo prohíbe. Una reserva lo declara: dice qué número, de quién, y por qué.
 *
 * Lo que una reserva NO puede tapar: un hueco que no está en esta lista sigue
 * en rojo, y un número reservado que YA existe como archivo no tapa nada —el
 * número está—, así que una reserva vieja es inofensiva: no se pone roja a
 * propósito, porque se vuelve vieja en el instante en que el dueño mergea, y
 * un rojo ahí lo pagaría `main`, no esta rama. Se borra al integrar.
 *
 * Es el mismo mecanismo que trae la rama de la `0032`
 * (`feat/la-grilla-mide-geografia`, que reserva la `0031`): la que mergee
 * segunda junta las dos listas, y las dos reservas quedan viejas.
 *
 * La `0032` es de la grilla GEO (H2-GO-3, `0032_geo_grid.sql`,
 * `feat/la-grilla-mide-geografia`), en un PR abierto el 2026-10-09 cuando la
 * `0033_seal_is_signed_by_sealer` se escribió con ese número por indicación de
 * la sesión directora.
 */
const RESERVADOS: ReadonlyArray<{ numero: number; porque: string }> = [
  { numero: 32, porque: "0032_geo_grid, H2-GO-3 (feat/la-grilla-mide-geografia)" },
];

describe("migration registry", () => {
  // Anti-vacuity. An empty or missing directory would make every assertion
  // below pass over nothing.
  it("finds the migrations at all", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain(`${REGISTRY_MIGRATION}.sql`);
  });

  it("numbers them consecutively from 0001", () => {
    const presentes = files.map((f) => Number(f.slice(0, 4)));
    // Un número reservado cuenta como presente SÓLO para cerrar su propio
    // hueco: si el archivo ya existe, no agrega nada (ver RESERVADOS). Un
    // duplicado entre archivos sigue viéndose, porque los reservados se suman
    // sin repetir.
    const numbers = [
      ...presentes,
      ...RESERVADOS.map((r) => r.numero).filter((n) => !presentes.includes(n)),
    ].sort((a, b) => a - b);
    const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);

    expect(
      numbers,
      "a gap or a duplicate here means two migrations can be applied in an " +
        "order nobody agreed on, and the replica and the hosted database can " +
        "disagree about which one that was"
    ).toEqual(expected);
  });

  it("registers every migration from the registry onward", () => {
    const registryIndex = files.indexOf(`${REGISTRY_MIGRATION}.sql`);
    const shouldRegister = files.slice(registryIndex);

    const missing = shouldRegister.filter((file) => {
      const source = readFileSync(path.join(MIGRATIONS, file), "utf8");
      // Its own version string, inserted into the registry table. Matching the
      // literal rather than the statement shape keeps the failure obvious: the
      // file never mentions its own name.
      return !source.includes(`'${version(file)}'`);
    });

    expect(
      missing,
      `These migrations never write their own row into schema_migrations, so a ` +
        `database that has them applied will report that it does not. End the ` +
        `file with:\n\n` +
        `  INSERT INTO public.schema_migrations (version) VALUES ('<name>')\n` +
        `  ON CONFLICT (version) DO NOTHING;`
    ).toEqual([]);
  });

  it("backfills every migration older than the registry", () => {
    const registryIndex = files.indexOf(`${REGISTRY_MIGRATION}.sql`);
    const older = files.slice(0, registryIndex).map(version);
    const registry = readFileSync(
      path.join(MIGRATIONS, `${REGISTRY_MIGRATION}.sql`),
      "utf8"
    );

    const missing = older.filter((v) => !registry.includes(`'${v}'`));

    expect(
      missing,
      `${REGISTRY_MIGRATION}.sql backfills the migrations that predate it, and ` +
        `these are not in its list. A database with them applied would report ` +
        `otherwise.`
    ).toEqual([]);
  });
});
