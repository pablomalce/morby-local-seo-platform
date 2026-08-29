-- 0003_expand_tenant_isolation.down.sql
--
-- LO QUE SE PIERDE AL REVERTIR, Y NO ES POCO. La 0003 cerró seis defectos de
-- aislamiento que la suite mide vivos contra el esquema sin ella. Esta vuelta
-- atrás los REABRE, los seis, y hay que decirlo entero antes de correrla:
--
--   1. `activity_logs` vuelve a la policy con `organization_id is null or ...`,
--      así que una línea de log sin tenant vuelve a ser legible por TODOS los
--      miembros de TODAS las organizaciones. Medido: bob leyó la fila de alice;
--   2. `agent_runs` vuelve a la misma forma con `business_id is null or ...`, y
--      una corrida sin negocio vuelve a ser legible y escribible por cualquiera;
--   3. `content_assets.service_id` vuelve a poder apuntar al servicio de otro
--      negocio —y por lo tanto de otro tenant—: la clave foránea compuesta que
--      lo hacía imposible desaparece y no queda nada estructural en su lugar;
--   4. `business_locations.is_primary` vuelve a nacer en `true` y sin índice
--      único, así que un negocio vuelve a poder tener N ubicaciones primarias
--      a la vez y el código vuelve a elegir la que la base devuelva primero;
--   5. `businesses` vuelve a poder cambiar de organización sin que nada avise:
--      los hijos referencian por `business_id` solo y se mudan de tenant en
--      silencio, sin una escritura propia ni rastro en ninguno de ellos;
--   6. las tablas pierden FORCE ROW LEVEL SECURITY, o sea que el DUEÑO de la
--      tabla vuelve a quedar exento de sus propias policies. Cualquier cosa
--      que se conecte como dueño —una migración, un job, una consola— vuelve a
--      estar afuera del aislamiento.
--
-- Y UNA PÉRDIDA QUE NO SE DESHACE. El punto 4 de la migración no sólo cambió el
-- esquema: corrió un UPDATE que apagó `is_primary` en las ubicaciones duplicadas,
-- dejando la más vieja de cada negocio como única primaria. Esta vuelta atrás
-- NO restaura ese dato, porque no hay dónde leerlo: la migración no guardó cuáles
-- filas tocó. El esquema vuelve idéntico; las filas apagadas se quedan apagadas.
-- Si eso importa, hay que mirar `business_locations` a mano DESPUÉS de revertir.
--
-- El orden de acá abajo es el inverso del de la migración, y en las claves
-- foráneas eso no es estilo: la única compuesta apunta al UNIQUE que la 0003
-- agregó, así que hay que sacarla antes que a él.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. FORCE ROW LEVEL SECURITY, primero porque es lo último que puso la 0003
-- ─────────────────────────────────────────────────────────────────────────────
-- Se saca de las tablas que tienen RLS Y FORCE, que es exactamente el conjunto
-- que la migración alcanzó: su DO block recorrió `relrowsecurity AND NOT
-- relforcerowsecurity`, y antes de ella NINGUNA tabla de `public` tenía FORCE
-- —las catorce de la 0001 y `pagespeed_cache` de la 0002 hacen ENABLE y nada
-- más—. Un `NO FORCE` a ciegas sobre todas las tablas daría el mismo resultado
-- hoy y sería falso el día que una migración anterior ponga FORCE en una sola.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El trigger que rechazaba la mudanza de tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- La función se tira entera: no existía antes de la 0003, así que no hay ACL
-- que reponer ni grant que se pierda. Con ella se va la única cosa que impedía
-- que un negocio cambiara de organización.
DROP TRIGGER IF EXISTS trg_businesses_no_reparenting ON public.businesses;
DROP FUNCTION IF EXISTS public.reject_business_reparenting();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Una sola ubicación primaria por negocio
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.business_locations_one_primary_per_business;
ALTER TABLE public.business_locations ALTER COLUMN is_primary SET DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La clave compuesta de content_assets.service_id
-- ─────────────────────────────────────────────────────────────────────────────
-- Primero la foránea y después el UNIQUE al que apunta. Al revés, PostgreSQL
-- rechaza el DROP del UNIQUE por estar referenciado.
--
-- Y NO se repone `content_assets_service_id_fkey`: esa clave simple sigue
-- existiendo en este punto de la historia. La 0003 agregó la compuesta AL LADO
-- de ella; la que la borra es la 0004, y deshacer eso es trabajo del .down de
-- la 0004.
ALTER TABLE public.content_assets
  DROP CONSTRAINT IF EXISTS content_assets_service_same_business_fkey;
ALTER TABLE public.business_services
  DROP CONSTRAINT IF EXISTS business_services_business_id_id_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. agent_runs vuelve a tolerar corridas sin negocio
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_business_id_not_null;

DROP POLICY IF EXISTS "runs_rw_member" ON public.agent_runs;
CREATE POLICY "runs_rw_member" ON public.agent_runs
  FOR ALL USING (
    business_id is null
    or business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  )
  WITH CHECK (
    business_id is null
    or business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. activity_logs vuelve a la rama sin tenant
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.activity_logs
  DROP CONSTRAINT IF EXISTS activity_logs_organization_id_not_null;

DROP POLICY IF EXISTS "logs_select_member" ON public.activity_logs;
CREATE POLICY "logs_select_member" ON public.activity_logs
  FOR SELECT USING (
    organization_id is null
    or organization_id in (select public.current_user_org_ids())
  );

DROP POLICY IF EXISTS "logs_insert_member" ON public.activity_logs;
CREATE POLICY "logs_insert_member" ON public.activity_logs
  FOR INSERT WITH CHECK (
    organization_id is null
    or organization_id in (select public.current_user_org_ids())
  );

-- `schema_migrations` no existe todavía en este punto de la historia: la crea la
-- 0008. Sin la guarda, `rollback.sh` muere con `relation "public.schema_migrations"
-- does not exist` y este .down no se puede probar nunca.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '0003_expand_tenant_isolation';
  END IF;
END
$$;
