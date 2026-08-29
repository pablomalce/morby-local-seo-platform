-- forma_canonica.sql — que la validación de la pantalla y el CHECK de la 0017
-- no se separen sin que nada lo diga.
--
-- QUÉ IMPIDE ESTE ARCHIVO
--
-- La `0017` guarda `property_ref` con un CHECK de forma, y la unicidad GLOBAL
-- sobre `(provider, lower(property_ref))` sólo significa algo si la forma es
-- única: `123456` y `properties/123456` son la misma property para Google y dos
-- filas distintas para PostgreSQL. La fuga entre clientes entra por la
-- ortografía.
--
-- `src/lib/integrations/google/mapping.ts` repite esa forma en JavaScript para
-- poder decirle al operador «se esperaba properties/N» antes de escribir. Dos
-- copias de una regla se separan; la pregunta es si algo lo dice cuando pasa.
--
-- ESTE ARCHIVO ES LA MITAD DE UN PAR
--
-- La otra mitad es el `describe("los patrones están clavados a un literal
-- escrito")` de `mapping.test.ts`, que clava los MISMOS tres patrones del lado
-- de JavaScript. Cada mitad escribe su literal por su cuenta, así que cambiar
-- una sola de las dos pone algo en rojo.
--
-- Y abajo, además, la tabla de casos: los literales pueden coincidir y las dos
-- expresiones significar cosas distintas igual, porque no son el mismo dialecto.
-- Las dos diferencias que hay, y son las únicas:
--
--   PostgreSQL          JavaScript
--   [^[:space:]]        \S           misma clase
--   /                   \/           la barra no necesita escaparse en PostgreSQL
--
-- La lista de casos es la que mide el significado. Cada valor válido es una
-- forma que una API de Google devuelve de verdad; cada inválido es una manera
-- concreta en que un humano la escribe mal.
--
-- No abre ninguna transacción larga ni escribe nada: es una lectura del catálogo
-- y una evaluación de expresiones.

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El CHECK del catálogo es el que este archivo cree que es
-- ─────────────────────────────────────────────────────────────────────────────
-- Se lee de `pg_get_constraintdef()` y no del archivo de migración: lo que
-- importa es lo que la base tiene puesto, no lo que el repositorio dice que le
-- puso. Son la misma cosa hasta que alguien aplica algo a mano.
DO $$
DECLARE src text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO src
      FROM pg_constraint
     WHERE conname = 'integration_properties_ref_shape_check';

    IF src IS NULL THEN
        RAISE EXCEPTION 'no existe integration_properties_ref_shape_check: la 0017 no está aplicada acá';
    END IF;

    IF position('^properties/[0-9]+$' IN src) = 0 THEN
        RAISE EXCEPTION E'el patrón de ga4 cambió en la base y mapping.ts no:\n%', src;
    END IF;
    IF position('^(sc-domain:[a-z0-9.-]+|https?://[^[:space:]]+/)$' IN src) = 0 THEN
        RAISE EXCEPTION E'el patrón de search_console cambió en la base y mapping.ts no:\n%', src;
    END IF;
    IF position('^locations/[0-9]+$' IN src) = 0 THEN
        RAISE EXCEPTION E'el patrón de google_business_profile cambió en la base y mapping.ts no:\n%', src;
    END IF;

    RAISE NOTICE 'los tres patrones del CHECK son los que mapping.ts clava';
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Los dos dialectos deciden lo mismo sobre los mismos valores
-- ─────────────────────────────────────────────────────────────────────────────
-- `js` es lo que `mapping.ts` contesta, escrito acá a mano. Es la misma lista
-- que `mapping.test.ts` ejercita del otro lado, valor por valor.
CREATE TEMP TABLE forma_casos(surface text, ref text, js boolean);

INSERT INTO forma_casos(surface, ref, js) VALUES
    ('ga4',                     'properties/123456789',             true),
    ('ga4',                     '123456789',                        false),
    ('ga4',                     'property/123456789',               false),
    ('ga4',                     'properties/G-ABC123',              false),
    ('ga4',                     'properties/',                      false),
    ('ga4',                     'locations/123456789',              false),
    ('search_console',          'https://ejemplo.com/',             true),
    ('search_console',          'https://ejemplo.com',              false),
    ('search_console',          'sc-domain:ejemplo.com',            true),
    ('search_console',          'sc-domain:Ejemplo.com',            false),
    ('search_console',          'http://ejemplo.com/',              true),
    ('search_console',          'https://ejemplo.com/tienda/',      true),
    ('search_console',          'ejemplo.com',                      false),
    ('search_console',          'sc-domain ejemplo.com',            false),
    ('search_console',          'https://ejemplo .com/',            false),
    ('google_business_profile', 'locations/123456789',              true),
    ('google_business_profile', 'accounts/111/locations/123456789', false);

-- Evaluado con las MISMAS expresiones del CHECK, ya comprobadas arriba contra el
-- catálogo. Evaluarlo intentando un INSERT sería más directo y necesitaría una
-- organización sembrada; esto mide la misma expresión sin tocar ninguna tabla.
CREATE TEMP TABLE forma_resultado AS
SELECT c.surface, c.ref, c.js,
       CASE c.surface
           WHEN 'ga4'
               THEN c.ref ~ '^properties/[0-9]+$'
           WHEN 'search_console'
               THEN c.ref ~ '^(sc-domain:[a-z0-9.-]+|https?://[^[:space:]]+/)$'
           WHEN 'google_business_profile'
               THEN c.ref ~ '^locations/[0-9]+$'
           ELSE false
       END AS pg
  FROM forma_casos c;

DO $$
DECLARE
    n      int;
    total  int;
    detail text;
BEGIN
    -- Anti-vacuidad, como en defects_test.sql: diecisiete casos escritos,
    -- diecisiete evaluados. Menos quiere decir que la lista se recortó y este
    -- archivo estaría diciendo «coinciden» sobre lo que quedó.
    SELECT count(*) INTO total FROM forma_resultado;
    IF total <> 17 THEN
        RAISE EXCEPTION 'Corrida vacua: % de 17 casos se evaluaron.', total;
    END IF;

    SELECT count(*) INTO n FROM forma_resultado WHERE js IS DISTINCT FROM pg;
    IF n > 0 THEN
        SELECT string_agg(format('  %s / %L: mapping.ts dice %s, la base dice %s',
                                 surface, ref, js, pg), chr(10) ORDER BY surface, ref)
          INTO detail
          FROM forma_resultado WHERE js IS DISTINCT FROM pg;
        RAISE EXCEPTION E'% de 17 casos donde mapping.ts y el CHECK no coinciden:\n%', n, detail;
    END IF;

    RAISE NOTICE 'Los 17 casos de forma coinciden entre mapping.ts y el CHECK de la 0017.';
END
$$;

ROLLBACK;
