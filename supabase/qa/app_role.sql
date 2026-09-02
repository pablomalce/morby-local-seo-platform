-- The role the assertions run as.
--
-- The application must never connect as the owner. A superuser bypasses RLS
-- unconditionally, and the table owner is exempt anywhere FORCE is missing.
-- Asserting isolation as either of them would be asserting nothing — which is
-- exactly what defect 6 is about.
--
-- NOLOGIN and no password, on purpose. Everything that uses this role reaches
-- it through SET ROLE from a connection that already exists — supabase/qa/
-- defects_test.sql and the schema job in CI both do. Nothing here needs a
-- connection of its own, so granting one would only add an account with a
-- password to every database this file is ever applied to. Check 11 of
-- defects_test.sql is what keeps that true.
--
-- To poke around as the application role, connect as the owner and drop into
-- it:  psql -U postgres -d growthos  then  SET ROLE growthos_app;
--
-- Used by both supabase/qa/replica.sh and the schema job in CI.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
        CREATE ROLE growthos_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

-- Corrective, not decorative. An earlier version of this file created the role
-- with LOGIN and the password 'growthos', so on any database where that one ran
-- the CREATE above is skipped and the account stays reachable over the network.
-- This is the line that closes it. Attributes that need superuser — SUPERUSER,
-- BYPASSRLS — are deliberately left to the CREATE: naming them here would abort
-- the file on Supabase, where the owner is not a superuser.
ALTER ROLE growthos_app NOLOGIN PASSWORD NULL;

-- Que quien aplica esto pueda entrar en el rol. Un superusuario hace SET ROLE a
-- cualquiera sin pedir permiso, y por eso esta línea no hacía falta mientras la
-- réplica corría sobre `postgres:17`, donde el dueño ERA superusuario. Sobre la
-- imagen de Supabase —y en hosted— `postgres` no lo es, y la primera corrida
-- murió en la línea 110 de defects_test.sql con
-- `permission denied to set role "growthos_app"`.
--
-- Desde PostgreSQL 16 la pertenencia a un rol y el derecho a ENTRAR en él son
-- dos cosas distintas, así que `WITH SET TRUE` no es adorno: sin eso la
-- pertenencia sola no habilita el SET ROLE.
--
-- Es una diferencia que el superusuario escondía, no una que aparezca ahora.
--
-- Y el rol se NOMBRA, no se escribe `CURRENT_USER`. La primera versión de esta
-- línea decía `TO CURRENT_USER` y **voltea el servidor**:
--
--     GRANT probe_role TO CURRENT_USER WITH SET TRUE;
--     server closed the connection unexpectedly
--     FATAL:  the database system is in recovery mode
--
-- Reproducido el 2026-08-28 en dos líneas sobre un contenedor limpio de
-- supabase/postgres:17.4.1.075, sin nada de este esquema puesto. Con el nombre
-- escrito, `GRANT ... TO postgres WITH SET TRUE`, funciona y el SET ROLE
-- después anda. `postgres` es el dueño acá y en hosted, así que nombrarlo no
-- pierde generalidad.
GRANT growthos_app TO postgres WITH SET TRUE;

GRANT USAGE ON SCHEMA public, auth TO growthos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO growthos_app;

-- Y lo que la aplicación NO tiene, este rol tampoco. Desde la 0013 ni `anon` ni
-- `authenticated` pueden borrar una membresía: la baja archiva. El GRANT de
-- arriba es sobre ALL TABLES y se la devolvería, y entonces la suite estaría
-- midiendo un rol que no existe en producción — el chequeo 17 pasaría en verde
-- por tener un privilegio de más, que es la peor manera de pasar.
--
-- Este REVOKE hay que aplicarlo también a hosted a mano, y no lo dice la huella:
-- `schema_fingerprint.sql` filtra los grants de tabla a
-- ('anon','authenticated','service_role'), así que un privilegio de growthos_app
-- que sobre en la base es invisible para el job de deriva. Medido el
-- 2026-08-21: hosted tenía el DELETE y la comparación daba verde igual.
REVOKE DELETE ON public.org_members FROM growthos_app;

-- Lo mismo para los tokens, por el mismo motivo. La 0014 le da a `authenticated`
-- SÓLO SELECT sobre integration_tokens: escribir un token es consecuencia de un
-- intercambio OAuth y ocurre en el servidor, con `service_role`. El GRANT de
-- arriba es sobre ALL TABLES y le devolvería a este rol un INSERT/UPDATE/DELETE
-- que la aplicación no tiene, así que el bloque 20 estaría midiendo un rol que
-- no existe en producción.
--
-- Y guardado, a diferencia del REVOKE de arriba. `rollback.sh` aplica este
-- archivo sobre el esquema tal como estaba ANTES de la migración que prueba, así
-- que al probar la 0014 lo corre cuando integration_tokens todavía no existe.
-- Sin la guarda, el script muere con `relation "public.integration_tokens" does
-- not exist` y ninguna migración nueva se puede volver a probar. org_members no
-- necesita esto porque existe desde la 0001.
DO $$
BEGIN
    IF to_regclass('public.integration_tokens') IS NOT NULL THEN
        REVOKE INSERT, UPDATE, DELETE ON public.integration_tokens FROM growthos_app;
    END IF;
END
$$;

-- Y lo mismo para el mapeo de propiedades, con más razón todavía. La 0017 le da a
-- `authenticated` SÓLO SELECT porque una sesión de navegador que pueda INSERTAR
-- un mapeo puede apuntar SU organización a la property de OTRO cliente: la fila
-- resultante es suya, pasa la RLS sin objeciones, y el token de agencia —que
-- llega a las dos propiedades— le sirve los datos ajenos. La escalada no ocurre
-- en la base, así que ninguna policy la puede ver; el único lugar donde se cierra
-- es el privilegio.
--
-- El GRANT sobre ALL TABLES de más arriba se lo devolvería, y entonces el bloque
-- 42 estaría midiendo un rol que no existe en producción — pasaría en verde por
-- tener un privilegio de más, que es la peor manera de pasar.
--
-- Guardado con `to_regclass` por el mismo motivo que el de arriba: `rollback.sh`
-- aplica este archivo sobre el esquema tal como estaba ANTES de la migración que
-- prueba, así que al probar la 0017 lo corre cuando integration_properties
-- todavía no existe. Sin la guarda el script muere con `relation
-- "public.integration_properties" does not exist` y ninguna migración nueva se
-- puede volver a probar.
DO $$
BEGIN
    IF to_regclass('public.integration_properties') IS NOT NULL THEN
        REVOKE INSERT, UPDATE, DELETE ON public.integration_properties FROM growthos_app;
    END IF;
END
$$;
-- ─────────────────────────────────────────────────────────────────────────────
-- Y NADA sobre `ingest_events`: ni leer.
-- ─────────────────────────────────────────────────────────────────────────────
-- Es la única tabla de la 0018 que una sesión de navegador no debe alcanzar de
-- ninguna forma, y las dos direcciones duelen distinto:
--
--   ESCRIBIR es reclamar la clave de idempotencia de OTRO lead ganado. La
--   restricción `(source_system, idempotency_key)` haría entonces exactamente lo
--   que existe para hacer —rechazar el segundo— sólo que el segundo sería el
--   verdadero: el cliente nunca se crea, y del lado del productor la entrega
--   figura como recibida. Es un cliente perdido en silencio.
--
--   LEER es la lista de qué clientes entraron y cuándo, para toda la plataforma.
--   La tabla no tiene RLS —es de la plataforma, como `schema_migrations`— así
--   que un SELECT no está filtrado por nadie.
--
-- Por eso acá se revoca TODO y no sólo la escritura, a diferencia de
-- `integration_tokens` y `integration_properties`, donde `authenticated` sí lee
-- lo suyo. El GRANT sobre ALL TABLES de más arriba se lo devolvería entero.
--
-- Guardado con `to_regclass` por el mismo motivo que los dos de arriba.
DO $$
BEGIN
    IF to_regclass('public.ingest_events') IS NOT NULL THEN
        REVOKE ALL ON public.ingest_events FROM growthos_app;
    END IF;
END
$$;

GRANT SELECT ON auth.users TO growthos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO growthos_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y NO la función de ingesta, que el GRANT de arriba le acaba de dar.
-- ─────────────────────────────────────────────────────────────────────────────
-- `ingest_lead_won` es `SECURITY DEFINER`: corre como su dueño y escribe en cinco
-- tablas sin que ninguna policy la mire — tiene que ser así, porque crea la
-- organización cuyo eje de tenant recién existe al terminar.
--
-- Eso la vuelve el objeto que MENOS puede quedar al alcance de una sesión de
-- navegador: quien la ejecuta crea organizaciones, negocios y contactos a
-- voluntad, y la RLS no tiene nada que objetar porque la función no está sujeta a
-- ella. Es saltear el aislamiento con más pasos.
--
-- El `GRANT EXECUTE ON ALL FUNCTIONS` de la línea de arriba se la otorga, así que
-- este REVOKE va DESPUÉS y no antes. El bloque 50 de defects_test.sql lo mide.
DO $$
BEGIN
    IF to_regprocedure('public.ingest_lead_won(text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.ingest_lead_won(text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb) FROM growthos_app;
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y NO las tres funciones de la custodia de tokens, que el GRANT de arriba le
-- acaba de dar.
-- ─────────────────────────────────────────────────────────────────────────────
-- `integration_token_secret` es el único objeto de `public` que devuelve un token
-- en claro, y las otras dos escriben uno. Las tres son `SECURITY INVOKER` —o sea
-- que quien las ejecute sin USAGE sobre `vault` va a fallar apenas lo toque— y
-- eso NO vuelve decorativo este REVOKE: `store_integration_token` alcanza a
-- REVOCAR el token vivo antes de llegar al Vault, y el error que devuelve después
-- no deshace ese UPDATE.
--
-- O sea que sin estas líneas el rol de la aplicación puede dejar a la plataforma
-- entera sin token con una sola llamada. Los bloques 54, 55 y 56 de
-- defects_test.sql lo miden, uno por función.
--
-- Guardado con `to_regprocedure` por el mismo motivo que el de arriba:
-- `rollback.sh` aplica este archivo sobre el esquema tal como estaba ANTES de la
-- migración que prueba, y al probar la 0021 lo corre cuando las tres funciones
-- todavía no existen.
DO $$
BEGIN
    IF to_regprocedure('public.store_integration_token(uuid, text, text, timestamptz)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.store_integration_token(uuid, text, text, timestamptz) FROM growthos_app;
    END IF;
    IF to_regprocedure('public.refresh_integration_token(uuid, text, text, timestamptz)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.refresh_integration_token(uuid, text, text, timestamptz) FROM growthos_app;
    END IF;
    IF to_regprocedure('public.integration_token_secret(uuid, text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.integration_token_secret(uuid, text) FROM growthos_app;
    END IF;
END
$$;

-- Y lo mismo para la sonda de integraciones, por el mismo motivo que las dos de
-- arriba. La 0022 le da a `authenticated` SÓLO SELECT: escribir el resultado de
-- una consulta es consecuencia de haberla hecho, y una sesión que pueda escribirlo
-- declara «ok» sobre una integración rota. El GRANT sobre ALL TABLES se lo
-- devolvería, y el bloque 63 estaría midiendo un rol que no existe en producción.
DO $$
BEGIN
    IF to_regclass('public.integration_probe') IS NOT NULL THEN
        REVOKE INSERT, UPDATE, DELETE ON public.integration_probe FROM growthos_app;
    END IF;
END
$$;
