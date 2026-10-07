-- Revierte la 0030.
--
-- QUÉ SE REABRE, Y ES TODO EL PUNTO DE LA 0030
--
-- Volver atrás deja la caché de PageSpeed como la dejó la `0005`:
--
--   * `anon` —la clave del bundle del navegador— vuelve a LEERLA entera, o sea
--     la lista de URLs de los clientes, sin sesión;
--   * `authenticated` —cualquiera que se registre: el alta está abierta— vuelve
--     a ESCRIBIRLA, y un resultado inventado para la URL de un cliente se sirve
--     24 h en su reporte (o para siempre, con un `fetched_at` futuro, si el
--     código también se revierte);
--   * la clave vuelve a ser la URL sola, compartida entre organizaciones.
--
-- SE BORRA LA CACHÉ, Y TIENE QUE SER ASÍ
--
-- Las filas de la `0030` son de una organización cada una, y dos
-- organizaciones pueden tener la misma URL. De vuelta a la clave `(url,
-- strategy)`, esas dos filas chocan y el `ADD PRIMARY KEY` aborta con 23505
-- (medido). Y si no chocaran, sería peor: la entrada de una organización
-- quedaría servida en el reporte de la otra, en una tabla que `anon` vuelve a
-- leer. Elegir cuál de las dos sobrevive sería inventar. Es una caché: lo que
-- se pierde cuesta una consulta a Google por sitio en el próximo reporte, igual
-- que cuando la `0030` borró lo que había.
--
-- EL CÓDIGO NO HACE FALTA REVERTIRLO, PERO SIN LA 0030 SU CACHÉ NO ANDA. El
-- orquestador que llegó con la `0030` lee y escribe con `service_role`
-- filtrando por `organization_id`; sobre el esquema revertido esa columna no
-- existe, así que la lectura da 42703 y el upsert PGRST204, los dos al log, y
-- cada reporte va a Google. Nada se cae. Revertir el código devolvería la
-- escritura a la sesión, que es la mitad del agujero.
--
-- QUÉ RESTAURA, EXACTAMENTE
--
-- Lo que la réplica tenía antes de la `0030`, medido el 2026-10-06 con
-- `relacl`, y que `rollback.sh` compara objeto por objeto:
--
--   anon           SELECT, REFERENCES, TRIGGER   (la `0010`, menos lo que sacaron
--                                                 la `0005` y la `0011`)
--   authenticated  SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
--   service_role   ALL                           (la `0010`)
--
-- la clave primaria `(url, strategy)` con su nombre de siempre, sin
-- `organization_id` ni su FK, y las tres policies con la forma que les dejó la
-- `0005`: la de lectura sin rol —o sea PUBLIC—, las de escritura
-- `TO authenticated`.
--
-- QUÉ NO TOCA
--
-- La RLS. ENABLE y FORCE estaban antes de la `0030` —los pusieron la `0002` y la
-- `0003`— y la `0030` sólo los volvió a escribir. Sacarlos acá dejaría la tabla
-- MÁS abierta que antes de la `0030`, que no es volver atrás.
--
-- Ni `growthos_app`: su alcance lo decide `supabase/qa/app_role.sql`, no las
-- migraciones.
--
-- En una transacción y con `ON_ERROR_STOP` propio, como los `.down` de la `0026`
-- a la `0028`: a medias, este archivo dejaría las policies sin el privilegio que
-- las hace alcanzables, o la tabla sin clave, y un `psql -f` a secas sigue de
-- largo después de un error.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM public.pagespeed_cache;

-- La clave, de vuelta a la URL sola. La columna se lleva su FK.
ALTER TABLE public.pagespeed_cache DROP CONSTRAINT pagespeed_cache_pkey;
ALTER TABLE public.pagespeed_cache DROP COLUMN organization_id;
ALTER TABLE public.pagespeed_cache
    ADD CONSTRAINT pagespeed_cache_pkey PRIMARY KEY (url, strategy);

DROP POLICY IF EXISTS "pagespeed_cache_select" ON public.pagespeed_cache;
CREATE POLICY "pagespeed_cache_select" ON public.pagespeed_cache
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pagespeed_cache_insert" ON public.pagespeed_cache;
CREATE POLICY "pagespeed_cache_insert" ON public.pagespeed_cache
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pagespeed_cache_update" ON public.pagespeed_cache;
CREATE POLICY "pagespeed_cache_update" ON public.pagespeed_cache
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, REFERENCES, TRIGGER ON public.pagespeed_cache TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.pagespeed_cache TO authenticated;
GRANT ALL ON public.pagespeed_cache TO service_role;

NOTIFY pgrst, 'reload schema';

-- Aparte de la huella, y no es redundante: `schema_fingerprint.sql` compara
-- OBJETOS, no contenido de tablas, así que un .down que se olvide esta línea
-- pasa la comparación, y `check_drift.sh` informaría «no falta ninguna» sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0030_pagespeed_cache_server_only';

COMMIT;
