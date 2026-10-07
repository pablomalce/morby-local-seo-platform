-- Revierte la 0029.
--
-- QUÉ SE PIERDE
--
-- Las cuatro tablas del tablero y con ellas TODO el tablero de todas las
-- organizaciones: tarjetas, responsables, colaboradores, dependencias, fuentes,
-- aprobaciones y resultados. Es trabajo humano que nadie puede regenerar, como la
-- ficha de la `0026`.
--
-- El proyecto hosted de este repositorio vive en el tier gratuito de Supabase,
-- sin backups automáticos ni PITR, así que «exportar antes» no es una
-- recomendación: es la única red que hay (§12.15 del director).
--
-- Y POR ESO SE NIEGA A CORRER mientras exista UNA tarjeta, salvo que quien lo
-- corre lo pida con todas las letras, en la MISMA sesión:
--
--     psql ... -c "SET vulkan.perder_el_tablero = 'si'" -f 0029_board.down.sql
--
-- El camino, con datos:
--
--   1. exportar las cuatro tablas, por ejemplo
--      `pg_dump --data-only -t 'public.board_*'`, y comprobar que el export se
--      puede leer de vuelta (§12.15);
--   2. correr esto con el SET de arriba.
--
-- El permiso vale para UNA corrida: este archivo lo consume al terminar. Y se
-- niega si el permiso viene de un lugar donde el `RESET` no llega —`PGOPTIONS`,
-- `ALTER ROLE ... SET`, `ALTER DATABASE ... SET`—, porque ése sobrevive al
-- `RESET` y valdría para todas las corridas que vengan. Es la comprobación del
-- `.down` de la `0026` (#107), copiada con su motivo.
--
-- MEDIDO el 2026-10-06 sobre una base con UNA tarjeta: sin permiso, se niega y
-- las tablas y el registro quedan; con `PGOPTIONS="-c vulkan.perder_el_tablero=si"`,
-- se niega igual; con el `SET` en la sesión, revierte —tablas y registro fuera— y
-- el permiso queda vacío después; una segunda corrida sobre la base ya revertida
-- pasa sin pedir nada. Y `supabase/qa/rollback.sh 0029_board` deja la huella
-- idéntica (1010 objetos); con el `DELETE` del registro quitado, se pone rojo.
--
-- Y NO SÓLO A MANO: `rollback.sh` siembra una tarjeta
-- (`supabase/qa/down_con_datos/0029_board.sql`) en una copia de la base
-- migrada y exige, desde el 2026-10-06, negarse sin permiso, negarse con el
-- permiso en PGOPTIONS nombrándolo y revertir con el SET; y desde el
-- 2026-10-07, porque una segunda ronda de verificación encontró cuatro mutantes
-- de este archivo que lo dejaban en verde: negarse con un permiso que no es
-- 'si' (`SET ... = 'no'`); al revertir, sacar la fila del registro también en
-- el camino POBLADO —el chequeo del registro corría sólo sobre la base vacía— y
-- dejar el permiso vacío en la MISMA sesión —cada paso era un `psql` nuevo y la
-- sesión moría con el permiso adentro, así que nadie miraba el `RESET` de
-- abajo—; y, en otra copia con el tablero vacío, negarse a una tarjeta que otra
-- sesión confirma MIENTRAS esto corre —nadie ejercitaba el lock de abajo, y
-- sin él el DROP se llevaba esa tarjeta sin permiso—. Cada conducta tiene su
-- mutación de este archivo medida en rojo, ocho en total (encabezado de la
-- `0029`).
--
-- LAS NEGATIVAS SE PROTEGEN SOLAS: `ON_ERROR_STOP` propio, todo en UNA
-- transacción, y el lock va ANTES de contar, para que nadie cree una tarjeta
-- entre que se miró y que se borró. Un lock sobre `board_cards` alcanza para las
-- cuatro: ninguna hija entra sin que su FK lea la fila de la tarjeta, y esa
-- lectura espera al lock.
--
-- QUÉ NO SE PIERDE
--
-- Nada fuera del tablero. La `0029` no tocó ninguna tabla que ya existía: ni
-- `org_members`, ni `businesses`, ni `organizations`. Las FK que van de las
-- tarjetas hacia esas tablas se van con las tarjetas.
--
-- EL ORDEN IMPORTA
--
-- Las tres hijas primero y la tarjeta al final. `DROP TABLE` sin CASCADE es la
-- comprobación: si algo que esta migración no creó quedó colgado de una tarjeta,
-- el rollback FALLA nombrándolo, en vez de borrarlo en silencio.
--
-- Las policies y los grants se van con cada tabla. No se revocan a mano: hacerlo
-- dejaría este archivo fallando la segunda vez que se corra.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_permiso  text := coalesce(current_setting('vulkan.perder_el_tablero', true), '');
    v_de_fondo text;
    v_tarjetas bigint;
BEGIN
    -- Una segunda corrida no tiene nada que perder y no tiene por qué negarse.
    IF to_regclass('public.board_cards') IS NULL THEN
        RETURN;
    END IF;

    LOCK TABLE public.board_cards IN ACCESS EXCLUSIVE MODE;

    SELECT count(*) INTO v_tarjetas FROM public.board_cards;
    IF v_tarjetas = 0 THEN
        RETURN;
    END IF;

    IF v_permiso <> 'si' THEN
        RAISE EXCEPTION 'hay % tarjetas en el tablero: este .down borra las cuatro tablas y ese trabajo humano no se regenera. Exportar primero (ver el encabezado); para seguir igual, en la MISMA sesion: SET vulkan.perder_el_tablero = ''si'';', v_tarjetas;
    END IF;

    -- De dónde viene el permiso. `RESET` lleva el valor al que tendría la sesión
    -- sin ningún SET: si ése ya es 'si', vino de PGOPTIONS o de un ALTER
    -- ROLE/DATABASE SET, el RESET del final no lo consume y valdría para siempre.
    RESET vulkan.perder_el_tablero;
    v_de_fondo := coalesce(current_setting('vulkan.perder_el_tablero', true), '');
    PERFORM set_config('vulkan.perder_el_tablero', v_permiso, false);
    IF v_de_fondo = 'si' THEN
        RAISE EXCEPTION 'el permiso vulkan.perder_el_tablero viene de PGOPTIONS o de un ALTER ROLE/DATABASE SET: sobrevive al RESET y valdria para todas las corridas. Sacarlo de ahi y darlo con SET en esta sesion.';
    END IF;
END $$;

DROP TABLE IF EXISTS public.board_card_sources;
DROP TABLE IF EXISTS public.board_card_dependencies;
DROP TABLE IF EXISTS public.board_card_collaborators;
DROP TABLE IF EXISTS public.board_cards;

-- Aparte de la huella, y no es redundante: `schema_fingerprint.sql` compara
-- OBJETOS, no contenido de tablas, así que un .down que se olvide esta línea
-- pasa la comparación, y `check_drift.sh` informaría «no falta ninguna» sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0029_board';

-- El permiso se consume: vale para UNA corrida. Dentro de la transacción: si algo
-- de arriba falla, el permiso queda para reintentar.
RESET vulkan.perder_el_tablero;

COMMIT;
