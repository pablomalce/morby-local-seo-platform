-- 0006_contract_tenant_not_null.down.sql
--
-- LO QUE SE PIERDE AL REVERTIR. La 0006 fue la mitad de contracción del eje de
-- tenant: validó los dos CHECK que la 0003 había dejado NOT VALID y convirtió
-- tres columnas en NOT NULL. Esta vuelta atrás las devuelve a nullable:
--
--   * `activity_logs.organization_id` vuelve a admitir NULL. Una línea de log sin
--     tenant vuelve a poder escribirse. Hoy la policy que puso la 0003 la deja
--     invisible para todos en vez de visible para todos —o sea que no se reabre
--     el defecto 1 entero— pero la fila entra, y queda ahí sin dueño;
--   * `agent_runs.business_id` vuelve a admitir NULL, y con eso vuelve la corrida
--     sin negocio;
--   * `agent_runs.organization_id` vuelve a admitir NULL. Es la peor de las tres:
--     `agent_runs_tenant_fkey` es MATCH SIMPLE, así que una fila con NULL en
--     cualquiera de las dos columnas NO se verifica contra `businesses`. Con la
--     columna nullable, la clave foránea compuesta deja de garantizar lo que
--     parece garantizar.
--
-- La red que queda después de revertir no es ninguna. Los dos CHECK vuelven —y
-- eso es lo que hace que esta vuelta atrás sea honesta y no un agujero— pero
-- vuelven NOT VALID, que es como los dejó la 0003: obligan a las filas NUEVAS y
-- no dicen nada de las que ya están. Ésa es exactamente la diferencia entre
-- expand y contract, y revertir la contracción es volver a no saber nada de lo
-- viejo.
--
-- `agent_runs.organization_id` se queda SIN check de ningún tipo, porque nunca
-- tuvo uno propio: la 0004 le puso la columna y el trigger de relleno, y la 0006
-- le puso el NOT NULL directamente. Lo único que la sostenía era
-- `agent_runs_tenant_pair_complete` —`business_id is null or organization_id is
-- not null`— que la 0004 dejó puesto y esta vuelta atrás no toca.
--
-- LO QUE NO SE DESHACE: nada de datos. La 0006 no escribió una sola fila; sólo
-- leyó (VALIDATE y SET NOT NULL escanean) y cambió catálogo. Es la única de las
-- tres vueltas del eje de tenant que no pierde trabajo al revertirse.
--
-- POR QUÉ LOS CHECK VUELVEN CON `NOT VALID` EXPLÍCITO. `pg_get_constraintdef()`
-- incluye el sufijo `NOT VALID` cuando `convalidated` es falso, y la huella
-- compara esa definición con un md5. Un check idéntico pero ya validado es una
-- diferencia que `rollback.sh` reporta, y con razón: un constraint validado
-- afirma algo sobre las filas viejas que el estado anterior no afirmaba.
--
-- Y EL ORDEN. Al revés que la migración: la 0006 hizo NOT NULL a `business_id`
-- antes que a `organization_id` porque el trigger de relleno deriva la segunda de
-- la primera. Acá se sueltan en el orden inverso, la derivada primero.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_runs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_runs ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE public.agent_runs ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_business_id_not_null
  CHECK (business_id is not null) NOT VALID;

-- ─────────────────────────────────────────────────────────────────────────────
-- activity_logs.organization_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.activity_logs ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_organization_id_not_null
  CHECK (organization_id is not null) NOT VALID;

-- `schema_migrations` no existe todavía en este punto de la historia: la crea la
-- 0008. Sin la guarda, `rollback.sh` muere con `relation "public.schema_migrations"
-- does not exist` y este .down no se puede probar nunca.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '0006_contract_tenant_not_null';
  END IF;
END
$$;
