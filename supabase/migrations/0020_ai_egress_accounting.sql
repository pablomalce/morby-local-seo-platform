-- 0020_ai_egress_accounting.sql — una corrida que dice «completada» trae su costo.
--
-- QUÉ CIERRA
--
-- R5 pide **un único módulo de egreso de IA con registro de coste**. La parte
-- difícil de esa frase no es «único»: es «con registro». Un módulo que registra
-- el costo cuando el que lo escribe se acuerda no registra el costo — registra
-- una intención, y la primera vez que alguien agrega un camino con prisa la
-- intención se pierde sin que nada lo diga.
--
-- `agent_runs` tiene `tokens_used` y `cost_usd` desde la `0001`, las dos
-- nullable, y al 2026-08-31 **nada en `src/` las escribe**. O sea que la columna
-- existía y la garantía no.
--
-- Esta migración la convierte en restricción: una fila que llega a `completed`
-- no puede existir sin sus tokens, su costo y su hora de fin.
--
-- POR QUÉ `completed` Y NO TAMBIÉN `failed`
--
-- Porque de una corrida fallida el esquema NO puede saber si hubo gasto. Un
-- proveedor que corta la conexión antes de procesar no cobró nada; uno que
-- devuelve un error después de generar la respuesta sí. Exigir el costo en
-- `failed` obligaría a escribir un cero cuando no se sabe, y un cero inventado es
-- peor que un nulo honesto: se suma.
--
-- Así que el reparto es éste, y está escrito para que nadie lo tome por descuido:
-- el ESQUEMA garantiza el caso que siempre se puede saber, y el MÓDULO registra
-- el gasto de un fallo cuando el proveedor se lo dice. Lo segundo no se puede
-- comprobar acá, y decirlo es parte del trabajo.
--
-- POR QUÉ SE PUEDE VALIDAR DE UNA
--
-- Medido en hosted antes de escribir esto: `agent_runs` tiene **cero filas**. No
-- hay pasado que tolerar, así que no hace falta el paso expand/contract que la
-- `0003` y la `0004` necesitaron — y una restricción `NOT VALID` que nadie valida
-- después es una restricción que sólo mira el futuro y no lo dice.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Una corrida completada está contabilizada
-- ─────────────────────────────────────────────────────────────────────────────
-- Las tres juntas y no sólo `cost_usd`: un costo sin tokens no se puede auditar
-- —no hay con qué recalcularlo cuando el precio del modelo cambie— y sin
-- `finished_at` no se puede atribuir a un período, que es la pregunta que todo
-- esto existe para contestar.
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_completed_is_accounted;
ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_completed_is_accounted
    CHECK (
        status <> 'completed'
        OR (tokens_used IS NOT NULL AND cost_usd IS NOT NULL AND finished_at IS NOT NULL)
    );

COMMENT ON COLUMN public.agent_runs.cost_usd IS
    'Lo que costó la llamada, en dólares. Obligatorio cuando status = completed; nullable en failed porque el esquema no puede saber si hubo gasto.';
COMMENT ON COLUMN public.agent_runs.tokens_used IS
    'Tokens de entrada más salida. Va junto al costo porque sin ellos el costo no se puede recalcular cuando cambie el precio del modelo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ni el costo ni los tokens pueden ser negativos
-- ─────────────────────────────────────────────────────────────────────────────
-- Parece obvio y no lo es: el modo de fallo que esto impide no es alguien
-- escribiendo `-5` a mano, es una resta mal puesta en el módulo —contar los
-- tokens de salida menos los de entrada, por ejemplo— que hace que la suma del
-- mes dé menos de lo gastado. Un total que se queda corto no llama la atención
-- de nadie.
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_cost_not_negative;
ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_cost_not_negative
    CHECK (cost_usd IS NULL OR cost_usd >= 0);

ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_tokens_not_negative;
ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_tokens_not_negative
    CHECK (tokens_used IS NULL OR tokens_used >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Una corrida no termina antes de empezar
-- ─────────────────────────────────────────────────────────────────────────────
-- El reloj de la aplicación y el de la base no son el mismo, y una corrida que
-- termina antes de empezar arruina cualquier atribución por período sin que la
-- fila se vea mal. Se compara con `>=` y no con `>`: una llamada de menos de un
-- microsegundo no existe, pero una marca de tiempo redondeada sí.
ALTER TABLE public.agent_runs
    DROP CONSTRAINT IF EXISTS agent_runs_finished_after_started;
ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_finished_after_started
    CHECK (finished_at IS NULL OR finished_at >= started_at);

INSERT INTO public.schema_migrations (version) VALUES ('0020_ai_egress_accounting')
ON CONFLICT (version) DO NOTHING;
