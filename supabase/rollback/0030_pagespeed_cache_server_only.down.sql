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
--     24 h en su reporte.
--
-- No se pierde ningún dato: la `0030` no borró filas y esto tampoco. Lo que se
-- pierde es el cierre.
--
-- EL CÓDIGO NO HACE FALTA REVERTIRLO, y conviene no hacerlo. El orquestador que
-- llegó con la `0030` lee y escribe con `service_role`, que conserva SELECT,
-- INSERT, UPDATE y DELETE en las dos direcciones (y ALL después de esto, como
-- antes), así que sigue andando sobre el esquema revertido. Revertir el código
-- devolvería la escritura a la sesión, que es la mitad del agujero.
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
-- y las tres policies con la forma que les dejó la `0005`: la de lectura sin rol
-- —o sea PUBLIC—, las de escritura `TO authenticated`.
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
-- las hace alcanzables, o al revés, y un `psql -f` a secas sigue de largo
-- después de un error.

\set ON_ERROR_STOP on

BEGIN;

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

-- Aparte de la huella, y no es redundante: `schema_fingerprint.sql` compara
-- OBJETOS, no contenido de tablas, así que un .down que se olvide esta línea
-- pasa la comparación, y `check_drift.sh` informaría «no falta ninguna» sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0030_pagespeed_cache_server_only';

COMMIT;
