-- 0020_ai_egress_accounting.down.sql — la vuelta atrás de la 0020.
--
-- La 0020 sólo agrega restricciones a una tabla que ya existía. Deshacerla es
-- sacarlas, y no se lleva ninguna fila.
--
-- LO QUE SE PIERDE, Y NO SE NOTA
--
-- La garantía de que una corrida completada trae su costo. Las columnas siguen
-- ahí y el módulo de egreso las sigue escribiendo, así que **nada falla el día
-- que se corre esto**. Lo que pasa es que vuelve a ser posible que un camino
-- nuevo escriba `completed` sin costo, y eso no se ve: la fila entra, el reporte
-- de gasto suma un poco menos, y nadie se entera hasta que la factura del
-- proveedor no coincide con la contabilidad propia.
--
-- Un total que se queda corto no llama la atención de nadie. Ésa es toda la razón
-- de que estas restricciones existan, y toda la razón para no sacarlas sin
-- decirlo.
--
-- No hay nada que respaldar: no se borra ni se modifica ningún dato.

\set ON_ERROR_STOP on

ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_completed_is_accounted;
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_cost_not_negative;
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_tokens_not_negative;
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_finished_after_started;

-- Los comentarios de columna también son parte de lo que la 0020 puso. Volverlos
-- a NULL y no dejarlos describiendo una garantía que ya no existe.
COMMENT ON COLUMN public.agent_runs.cost_usd IS NULL;
COMMENT ON COLUMN public.agent_runs.tokens_used IS NULL;

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0020_ai_egress_accounting';
