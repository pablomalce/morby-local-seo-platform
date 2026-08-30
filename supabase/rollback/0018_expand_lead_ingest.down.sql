-- 0018_expand_lead_ingest.down.sql — la vuelta atrás de la 0018.
--
-- A diferencia de la 0017, ésta NO es sólo tirar tablas: la 0018 agrega dos
-- columnas a tablas que ya existían y que ya tenían filas. Deshacerla tiene que
-- deshacer las cuatro cosas, y las dos columnas son las que se olvidan — el
-- `.down` de la 0004 prometía en su encabezado reponer una foránea y su SQL
-- nunca lo hacía, y eso pasó en este repositorio el 2026-08-29.
--
-- LO QUE SE LLEVA, Y HAY QUE LEERLO ANTES
--
-- 1. `public.contacts` ENTERA. Es la única copia de los datos de contacto de
--    cada cliente en Growth OS: nombre, correo, teléfono, sitio y —lo que más
--    pesa— `source`, que es de dónde salió el contacto. Ése es el campo que hay
--    que poder contestar cuando alguien ejerce un derecho de GDPR. Perderlo no
--    es perder una función: es perder la respuesta a un reclamo.
--
-- 2. `public.ingest_events` ENTERA, o sea **la memoria de qué leads ya se
--    procesaron**. Y esto es lo peor de esta vuelta atrás, porque no se nota:
--    el sistema sigue andando. Lo que pasa es que el productor reintenta un
--    `lead.won` que ya había entrado, la unicidad que lo hubiera rechazado ya no
--    existe, y el cliente se crea DOS VECES — con su Business y sus Locations
--    colgando de la segunda. Volver a aplicar la 0018 después no arregla nada:
--    la tabla vuelve vacía y las claves viejas ya no están.
--
-- 3. `businesses.slug` y `business_locations.postal_code`, con sus valores.
--
-- Así que antes de correr esto sobre una base con datos reales:
--
--     CREATE TABLE contacts_respaldo      AS SELECT * FROM public.contacts;
--     CREATE TABLE ingest_events_respaldo AS SELECT * FROM public.ingest_events;
--     CREATE TABLE slugs_respaldo         AS SELECT id, slug FROM public.businesses;
--     CREATE TABLE postales_respaldo      AS SELECT id, postal_code FROM public.business_locations;
--
-- El respaldo no es ceremonia: el proyecto hosted está en el tier gratuito de
-- Supabase, que no tiene backups automáticos ni PITR. Lo dice el encabezado de
-- rollback.sh.
--
-- No hay nada que preservar en `vault.secrets`: esta migración no guarda ni
-- referencia ningún secreto.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Las dos tablas nuevas
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada una se lleva sus policies, sus índices, sus CHECK, su trigger y sus FK.
-- Nombrarlas una por una antes sería escribir de más y arriesgarse a que la
-- lista quede desactualizada respecto de la migración.
DROP TABLE IF EXISTS public.ingest_events;
DROP TABLE IF EXISTS public.contacts;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las dos columnas, que son la parte que se olvida
-- ─────────────────────────────────────────────────────────────────────────────
-- El índice y el CHECK van explícitos ANTES del DROP COLUMN aunque `DROP COLUMN`
-- se los llevaría igual. Es a propósito: si mañana alguien cambia este archivo
-- para conservar la columna, las dos líneas de abajo siguen siendo las correctas
-- y el archivo no queda prometiendo algo que dejó de hacer.
DROP INDEX IF EXISTS public.businesses_one_slug_per_organization;
ALTER TABLE public.businesses
    DROP CONSTRAINT IF EXISTS businesses_slug_shape_check;
ALTER TABLE public.businesses
    DROP COLUMN IF EXISTS slug;

ALTER TABLE public.business_locations
    DROP COLUMN IF EXISTS postal_code;

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0018_expand_lead_ingest';
