-- 0008_schema_migrations.sql — qué migraciones tiene puestas esta base.
--
-- QUÉ CIERRA
--
-- Hasta acá no había forma de preguntarle a una base qué migraciones tenía
-- aplicadas. La única manera de saberlo era comparar catálogos con
-- supabase/qa/schema_fingerprint.sql y deducirlo de las diferencias, que es
-- cómo se descubrió que la 0006 llevaba mergeada y en verde mientras
-- `tpqiltnskfeycnybczgz` no la tenía.
--
-- Deducir sirve para investigar. No sirve para que un script decida qué aplicar,
-- ni para que alguien lo sepa de un vistazo.
--
-- CÓMO SE MANTIENE
--
-- Cada migración termina registrándose a sí misma, y el test
-- src/lib/store/__tests__/migrationsRegistered.test.ts falla si alguna no lo
-- hace. Que el registro sea responsabilidad de cada archivo y no de un runner
-- es a propósito: el runner acá es una persona con el SQL editor abierto, y una
-- persona se olvida. El archivo no.
--
-- La fila se escribe con ON CONFLICT DO NOTHING, así que reaplicar una
-- migración sobre una base que ya la tiene no falla por el registro — falla, si
-- falla, por lo que la migración hace, que es donde tiene que fallar.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version    text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.schema_migrations IS
    'Una fila por migración aplicada. La escribe cada migración al final de sí misma; no hay runner que lo haga.';

-- Nadie de la aplicación necesita esto: lo lee quien aplica migraciones, que se
-- conecta como dueño. RLS activo y sin policies deja la tabla fuera del alcance
-- de anon y de authenticated, que es lo correcto — dice qué defensas tiene la
-- base, y eso no es información para el bundle del navegador.
-- FORCE además de ENABLE, como las otras quince. Lo pidió el bloque 6 de la
-- suite y no una lectura: con sólo ENABLE la corrida quedó en `15 of 16 tables
-- have FORCE`. Quien aplica migraciones se conecta con BYPASSRLS —`postgres` lo
-- tiene en Supabase, y en la réplica es superusuario— así que sigue leyendo y
-- escribiendo esta tabla; lo que FORCE cierra es que el dueño quede exento por
-- el solo hecho de serlo.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations FORCE ROW LEVEL SECURITY;

-- Backfill de las siete anteriores. Están aplicadas sobre hosted y sobre
-- cualquier réplica construida desde este directorio: si el archivo corrió, la
-- migración está. La fecha real de aplicación se perdió y no se inventa — queda
-- la de este backfill, y este comentario dice por qué.
INSERT INTO public.schema_migrations (version) VALUES
    ('0001_init_growth_os'),
    ('0002_pagespeed_cache'),
    ('0003_expand_tenant_isolation'),
    ('0004_composite_tenant_key'),
    ('0005_lock_pagespeed_cache'),
    ('0006_contract_tenant_not_null'),
    ('0007_explicit_function_grants')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.schema_migrations (version) VALUES ('0008_schema_migrations')
ON CONFLICT (version) DO NOTHING;
