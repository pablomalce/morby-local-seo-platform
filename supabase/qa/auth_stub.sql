-- The two Supabase objects the Growth OS migrations reach for.
--
-- Grepping supabase/migrations for auth.* returns exactly auth.uid and
-- auth.users, so this stub is complete rather than approximate. Nothing else
-- about Supabase is reproduced, and nothing else is needed to exercise the
-- schema.
--
-- auth.uid() reads the JWT subject. Supabase fills it per request; here it
-- reads the same GUCs PostgREST would set, so a test can say "now I am this
-- user" and have every policy in the schema believe it. That is the point: the
-- policies run exactly as written, with the identity swapped underneath them.
--
-- Used by both supabase/qa/replica.sh and the schema job in CI. One file rather
-- than two copies: a stub that drifts between the local run and the CI run
-- would make them disagree about what was proved.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text UNIQUE,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);

-- La definición de GoTrue, no la del init de la imagen.
--
-- Hasta el 2026-10-09 este stub leía sólo `request.jwt.claim.sub`, el GUC por
-- claim que PostgREST ya no pone. Medido ese día sobre las imágenes locales del
-- stack de Supabase, sin correrlas (`docker create` + `docker cp`):
--
--   * PostgREST (`public.ecr.aws/supabase/postgrest:v16.4`): el binario nombra un
--     solo GUC de identidad, `request.jwt.claims` —el JSON entero del JWT—. El
--     `request.jwt.claim.sub` no aparece: con una sesión de verdad está vacío;
--   * GoTrue (`public.ecr.aws/supabase/gotrue:v2.197.0`), migración
--     `20220224000811_update_auth_functions`: `auth.uid()` es el coalesce de
--     abajo, el GUC viejo primero y el `sub` del JSON después. Es la que queda
--     en un proyecto de Supabase una vez que GoTrue corre sus migraciones. Contra
--     hosted no se midió: esta réplica existe para no tocarlo.
--
-- La imagen de esta réplica (`supabase/postgres`) trae la del init, la del GUC
-- viejo, porque acá GoTrue no corre. Con ella, una función que leyera
-- `request.jwt.claim.sub` en vez de llamar a `auth.uid()` pasaba la suite entera
-- y, con PostgREST v16 delante, vería NULL en toda sesión: medido con el trigger
-- de la 0033, 167 de 167 en verde y, por el camino de PostgREST, 45005 a la
-- escritura exacta de `/api/content/approve` (que la ruta contesta con 502). Con esta definición, los bloques
-- 220 a 227 entran por el JSON, como PostgREST, y los anteriores por el GUC
-- viejo, que sigue andando: los dos caminos de la misma función.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT coalesce(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

-- Los roles que Supabase trae de fábrica y que las policies nombran desde
-- 0005. Sin ellos, `create policy ... to authenticated` falla acá y el esquema
-- que se prueba deja de ser el que corre en producción. NOLOGIN: en la réplica
-- nadie se conecta con ellos, sólo se los nombra.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    -- El tercero faltaba, y se notó recién cuando 0007 le otorgó EXECUTE: la
    -- réplica abortó con `role "service_role" does not exist` mientras hosted
    -- lo tiene desde siempre. Un rol que está en producción y no en la réplica
    -- es una diferencia que aparece sólo el día que alguien lo nombra.
    -- BYPASSRLS porque así es allá, y omitirlo haría que cualquier aserción
    -- sobre él midiera un rol que no es el que corre.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- Que una sesión pueda LLAMAR a `auth.uid()` con su propio rol, como en hosted.
--
-- Medido el 2026-10-09 sobre la imagen que corre esta réplica
-- (supabase/postgres:17.4.1.075), en la base `postgres`, donde su init dejó el
-- esquema `auth` de verdad: `nspacl` da USAGE a `anon`, `authenticated`,
-- `service_role` y `postgres`, y `auth.uid()` es ejecutable por PUBLIC. Este stub
-- creaba el esquema sin ese USAGE, así que acá
--
--     SET ROLE authenticated; SELECT auth.uid();
--     ERROR:  permission denied for schema auth
--
-- y en hosted devuelve el uid. Nadie lo notaba, y no por casualidad: una policy
-- guarda la función por OID, así que evaluarla no BUSCA `auth.uid()` por nombre
-- y no pide USAGE sobre el esquema. Medido el mismo día, sin el USAGE: el owner
-- renombra su organización como `authenticated` —`orgs_update_owner`, de la
-- 0001, la única de `pg_policies` que nombra `auth.uid()`— y da `UPDATE 1`. Lo
-- que sí lo pide es código que resuelve el nombre al correr con el rol de quien
-- llama: un PL/pgSQL SECURITY INVOKER. El primero es el trigger de la 0033, que
-- es INVOKER a propósito —tiene que ver el rol de quien escribe—. Sin esta línea
-- la réplica le rechazaba con 42501 toda aprobación por sesión, una negativa que
-- hosted no tiene: más estricta que producción, en el sentido que hace pasar a
-- una aserción de negativa por el motivo equivocado (medido: sin el USAGE se
-- ponen rojos el 211 —marta ya no sella—, el 220, el 221, el 222 y el 225).
--
-- Sólo el USAGE del esquema: `auth.users` sigue sin privilegios para las
-- sesiones, igual que en hosted.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Los default privileges que Supabase deja puestos sobre `public`, que es la
-- diferencia que hacía a la réplica MÁS SEGURA que la base real.
--
-- En un proyecto de Supabase, todo objeto que se cree después en `public` nace
-- con GRANT ALL para los tres roles, porque el proyecto los trae de fábrica. En
-- una PostgreSQL pelada no, así que una migración que confiaba en que "nadie
-- tiene permiso hasta que se lo doy" pasaba verde acá y dejaba el permiso
-- abierto en hosted.
--
-- Medido contra `tpqiltnskfeycnybczgz` el 2026-08-26: los tiene puestos para
-- tablas, funciones y secuencias, los tres roles. Esta réplica no los tenía.
--
-- Es el mismo cambio que Lead Engine hizo ese día, y allá encontró que `anon`
-- tenía UPDATE sobre las doce secuencias de `public` sin que ninguna migración
-- lo otorgara. Acá no hay secuencias todavía, así que lo que se corrige es la
-- ceguera antes de que haya algo que esconder.
--
-- Una sentencia por tipo de objeto: PostgreSQL no acepta la lista junta.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
