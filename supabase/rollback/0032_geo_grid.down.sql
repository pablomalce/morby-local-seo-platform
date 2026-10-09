-- Revierte la 0032.
--
-- QUÉ SE PIERDE
--
-- Las tres tablas de la grilla y con ellas TODAS las corridas de todas las
-- organizaciones, con cada observación, y las aprobaciones de gasto. Las
-- corridas no se regeneran: una posición en Google
-- es un hecho de un momento —correr la misma grilla mañana da otro mapa, que es
-- justamente lo que la puerta H2-GO-3 mide— y cada punto costó una llamada paga
-- a Places Text Search. Es el mismo caso que el tablero de la `0029`: trabajo,
-- acá medición, que nadie puede volver a producir.
--
-- El proyecto hosted vive en el tier gratuito de Supabase, sin backups
-- automáticos ni PITR, así que «exportar antes» no es una recomendación: es la
-- única red que hay (§12.15 del director).
--
-- Y POR ESO SE NIEGA A CORRER mientras exista UNA corrida, salvo que quien lo
-- corre lo pida con todas las letras, en la MISMA sesión. Una aprobación de
-- gasto SIN corridas no frena el .down: es un permiso que no se usó, perderla
-- es fallar cerrado —se gasta menos, no más— y volver a aprobar es el mismo
-- acto humano. Una aprobación CON corridas se va con ellas, así que ya la cubre
-- la negativa:
--
--     psql ... -c "SET vulkan.perder_las_grillas = 'si'" -f 0032_geo_grid.down.sql
--
-- El camino, con datos:
--
--   1. exportar las tres tablas, por ejemplo
--      `pg_dump --data-only -t 'public.geo_grid_*'`, y comprobar que el export
--      se puede leer de vuelta (§12.15);
--   2. correr esto con el SET de arriba.
--
-- El permiso vale para UNA corrida: este archivo lo consume al terminar. Y se
-- niega si el permiso viene de un lugar donde el `RESET` no llega —`PGOPTIONS`,
-- `ALTER ROLE ... SET`, `ALTER DATABASE ... SET`—, porque ése sobrevive al
-- `RESET` y valdría para todas las corridas que vengan. Es la comprobación del
-- `.down` de la `0029`, copiada con su motivo, y `rollback.sh` la ejerce entera
-- con la siembra de `supabase/qa/down_con_datos/0032_geo_grid.sql`: negarse sin
-- permiso, con el permiso en PGOPTIONS y con un permiso que no es 'si';
-- revertir con el SET, sacar el registro y consumir el permiso; y negarse a una
-- corrida que otra sesión confirma MIENTRAS esto corre.
--
-- LAS NEGATIVAS SE PROTEGEN SOLAS: `ON_ERROR_STOP` propio, todo en UNA
-- transacción, y el lock va ANTES de contar, para que nadie cree una corrida
-- entre que se miró y que se borró. Un lock sobre `geo_grid_runs` alcanza para
-- las dos: ninguna observación entra sin que su FK lea la fila de la corrida, y
-- esa lectura espera al lock. Una aprobación nueva no espera ese lock, pero sin
-- una corrida no frena nada (ver arriba).
--
-- QUÉ NO SE PIERDE
--
-- Nada fuera de la grilla. La `0032` no tocó ninguna tabla que ya existía: ni
-- `org_members`, ni `businesses`, ni `organizations`. Las FK que van hacia esas
-- tablas se van con las tablas. Las policies —también las del eje de rol de la
-- `0031`, si la sección 4 las puso— y los grants se van con cada tabla.
--
-- EL ORDEN IMPORTA
--
-- La hija primero y la aprobación al final: observaciones, corridas,
-- aprobaciones. `DROP TABLE` sin CASCADE es la comprobación: si algo que esta
-- migración no creó quedó colgado de una corrida o de una aprobación, el
-- rollback FALLA nombrándolo, en vez de borrarlo en silencio.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_permiso  text := coalesce(current_setting('vulkan.perder_las_grillas', true), '');
    v_de_fondo text;
    v_corridas bigint;
BEGIN
    -- Una segunda corrida no tiene nada que perder y no tiene por qué negarse.
    IF to_regclass('public.geo_grid_runs') IS NULL THEN
        RETURN;
    END IF;

    LOCK TABLE public.geo_grid_runs IN ACCESS EXCLUSIVE MODE;

    SELECT count(*) INTO v_corridas FROM public.geo_grid_runs;
    IF v_corridas = 0 THEN
        RETURN;
    END IF;

    IF v_permiso <> 'si' THEN
        RAISE EXCEPTION 'hay % corridas de grilla: este .down borra las dos tablas y esas mediciones no se regeneran. Exportar primero (ver el encabezado); para seguir igual, en la MISMA sesion: SET vulkan.perder_las_grillas = ''si'';', v_corridas;
    END IF;

    -- De dónde viene el permiso. `RESET` lleva el valor al que tendría la sesión
    -- sin ningún SET: si ése ya es 'si', vino de PGOPTIONS o de un ALTER
    -- ROLE/DATABASE SET, el RESET del final no lo consume y valdría para siempre.
    RESET vulkan.perder_las_grillas;
    v_de_fondo := coalesce(current_setting('vulkan.perder_las_grillas', true), '');
    PERFORM set_config('vulkan.perder_las_grillas', v_permiso, false);
    IF v_de_fondo = 'si' THEN
        RAISE EXCEPTION 'el permiso vulkan.perder_las_grillas viene de PGOPTIONS o de un ALTER ROLE/DATABASE SET: sobrevive al RESET y valdria para todas las corridas. Sacarlo de ahi y darlo con SET en esta sesion.';
    END IF;
END $$;

DROP TABLE IF EXISTS public.geo_grid_observations;
DROP TABLE IF EXISTS public.geo_grid_runs;
DROP TABLE IF EXISTS public.geo_grid_spend_approvals;

-- Aparte de la huella, y no es redundante: `schema_fingerprint.sql` compara
-- OBJETOS, no contenido de tablas, así que un .down que se olvide esta línea
-- pasa la comparación, y `check_drift.sh` informaría «no falta ninguna» sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0032_geo_grid';

-- El permiso se consume: vale para UNA corrida. Dentro de la transacción: si algo
-- de arriba falla, el permiso queda para reintentar.
RESET vulkan.perder_las_grillas;

COMMIT;
