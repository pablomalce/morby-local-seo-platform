-- Revierte la 0026.
--
-- QUÉ SE PIERDE
--
-- Las ocho tablas y con ellas TODA la ficha de todos los clientes: oferta,
-- mercados, segmentos, competidores curados, ICP, objetivos y evidencia. A
-- diferencia del .down de la `0025` —que pierde mediciones reproducibles
-- corriendo la auditoría de nuevo— lo que se pierde acá es TRABAJO HUMANO que
-- nadie puede regenerar.
--
-- El proyecto hosted de este repositorio vive en el tier gratuito de Supabase,
-- que no tiene backups automáticos ni PITR. O sea que «exportar antes» no es una
-- recomendación: es la única red que hay (§12.15 del director: un respaldo no
-- probado no es un respaldo).
--
-- Y POR ESO SE NIEGA A CORRER mientras exista UNA fila en `company_profiles`,
-- salvo que quien lo corre lo pida con todas las letras, en la MISMA sesión:
--
--     psql ... -c "SET vulkan.perder_la_ficha = 'si'" -f 0026_company_profile.down.sql
--
-- Antes lo decía sólo en prosa, y la prosa no frena nada: medido el 2026-09-30
-- en la réplica, revisando H1.2, este archivo borró la ficha entera —las ocho
-- tablas, con versiones publicadas adentro— sin una sola pregunta.
--
-- El camino, con datos:
--
--   1. exportar las ocho tablas y los punteros de `competitors`, por ejemplo
--      `pg_dump --data-only -t 'public.company_profiles' -t 'public.profile_*'`
--      más `SELECT id, profile_competitor_id FROM public.competitors WHERE
--      profile_competitor_id IS NOT NULL`, y comprobar que el export se puede
--      leer de vuelta (§12.15);
--   2. correr esto con el SET de arriba.
--
-- El permiso vale para UNA corrida: este archivo lo consume al terminar. Y se
-- niega si el permiso viene de un lugar donde el `RESET` no llega —`PGOPTIONS`,
-- `ALTER ROLE ... SET`, `ALTER DATABASE ... SET`—, porque ése sobrevive al
-- `RESET` y valdría para todas las corridas que vengan. Medido el 2026-10-01: con
-- `PGOPTIONS="-c vulkan.perder_la_ficha=si"`, después del `RESET` el valor
-- sigue siendo `si`. El `.down` de la `0027` tenía ese mismo hueco; desde el
-- #106 hace esta misma comprobación.
--
-- LAS NEGATIVAS SE PROTEGEN SOLAS, igual que en el `.down` de la `0027`: el
-- `ON_ERROR_STOP` es del archivo y no de quien lo invoca, así que con un
-- `psql -f` a secas la negativa corta la corrida en vez de imprimirse y seguir
-- con los DROP; todo va en UNA transacción; y el lock va ANTES de contar, para
-- que nadie publique una versión entre que se miró y que se borró. Un lock sobre
-- `company_profiles` alcanza para las ocho: ninguna hija entra sin que su FK
-- lea la fila de la ficha, y esa lectura espera al lock.
--
-- QUÉ NO SE PIERDE
--
-- Las filas de `competitors`. La columna `profile_competitor_id` se va y el
-- resto de la fila queda: es exactamente por eso que el puntero va en esa
-- dirección (decisión 12 de la 0026).
--
-- Tampoco se pierde nada de `business_services`: la `0026` sólo le agregó una
-- única sobre `(organization_id, id)` para que la FK de `profile_offers.service_id`
-- tuviera adónde apuntar (decisión 14), y acá se saca. Sacarla no toca ninguna
-- fila, igual que ponerla no restringía ninguna —`id` ya es PK—.
--
-- EL ORDEN IMPORTA
--
-- La columna de `competitors` PRIMERO. Si se dejara para el final, el
-- `DROP TABLE profile_competitors` tendría que ser CASCADE para llevarse la FK,
-- y un CASCADE en un .down es la clase de instrucción que un día se lleva algo
-- que nadie nombró.
--
-- Después las hijas y al final la ficha. `DROP TABLE` sin CASCADE es la
-- comprobación: si algo que esta migración no creó quedó colgado de la ficha, el
-- rollback FALLA nombrándolo, en vez de borrarlo en silencio.
--
-- Las políticas y los grants se van con cada tabla. No se revocan a mano:
-- hacerlo dejaría este archivo fallando la segunda vez que se corra.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_permiso   text := coalesce(current_setting('vulkan.perder_la_ficha', true), '');
    v_de_fondo  text;
    v_versiones bigint;
BEGIN
    -- Una segunda corrida no tiene nada que perder y no tiene por qué negarse:
    -- sin la tabla, ni el lock ni la cuenta tienen sobre qué correr.
    IF to_regclass('public.company_profiles') IS NULL THEN
        RETURN;
    END IF;

    LOCK TABLE public.company_profiles IN ACCESS EXCLUSIVE MODE;

    SELECT count(*) INTO v_versiones FROM public.company_profiles;
    IF v_versiones = 0 THEN
        RETURN;
    END IF;

    IF v_permiso <> 'si' THEN
        RAISE EXCEPTION 'hay % versiones de la ficha: este .down borra las ocho tablas y ese trabajo humano no se regenera. Exportar primero (ver el encabezado); para seguir igual, en la MISMA sesion: SET vulkan.perder_la_ficha = ''si'';', v_versiones;
    END IF;

    -- De dónde viene el permiso. `RESET` lleva el valor al que tendría la sesión
    -- sin ningún SET: si ése ya es 'si', el permiso vino de PGOPTIONS o de un
    -- ALTER ROLE/DATABASE SET, el RESET del final no lo consume y valdría para
    -- siempre. Se lee y se devuelve el valor como estaba.
    RESET vulkan.perder_la_ficha;
    v_de_fondo := coalesce(current_setting('vulkan.perder_la_ficha', true), '');
    PERFORM set_config('vulkan.perder_la_ficha', v_permiso, false);
    IF v_de_fondo = 'si' THEN
        RAISE EXCEPTION 'el permiso vulkan.perder_la_ficha viene de PGOPTIONS o de un ALTER ROLE/DATABASE SET: sobrevive al RESET y valdria para todas las corridas. Sacarlo de ahi y darlo con SET en esta sesion.';
    END IF;
END $$;

ALTER TABLE public.competitors
    DROP CONSTRAINT IF EXISTS competitors_profile_competitor_fkey;

DROP INDEX IF EXISTS public.competitors_profile_competitor_idx;

ALTER TABLE public.competitors
    DROP COLUMN IF EXISTS profile_competitor_id;

-- La evidencia antes que los objetivos, el ICP antes que los segmentos: cada
-- una tiene un padre dentro de este mismo conjunto.
DROP TABLE IF EXISTS public.profile_evidence;
DROP TABLE IF EXISTS public.profile_objectives;
DROP TABLE IF EXISTS public.profile_icp;
DROP TABLE IF EXISTS public.profile_segments;
DROP TABLE IF EXISTS public.profile_competitors;
DROP TABLE IF EXISTS public.profile_markets;
DROP TABLE IF EXISTS public.profile_offers;

DROP TABLE IF EXISTS public.company_profiles;

-- La única de `business_services`, DESPUÉS de las tablas y no antes: mientras
-- `profile_offers` exista, su FK depende de ella y este DROP CONSTRAINT falla
-- —nombrando la dependencia, que es la dirección barata—. Con la tabla ya
-- borrada, la constraint queda sin usuarios y se va sola.
--
-- Y sin CASCADE, por el mismo motivo que los DROP TABLE de arriba: si algo que
-- esta migración no creó llegó a depender de esta única, el rollback FALLA
-- nombrándolo en vez de llevárselo en silencio.
ALTER TABLE public.business_services
    DROP CONSTRAINT IF EXISTS business_services_organization_id_id_key;

-- Después de las tablas: la columna generada de `profile_evidence` dependía de
-- esta función, así que antes el DROP fallaría — y fallar acá dejaría el esquema
-- a medio revertir, que es el estado que este archivo existe para evitar.
DROP FUNCTION IF EXISTS public.url_host(text);

-- Aparte de la huella, y no es redundante: `schema_fingerprint.sql` compara
-- OBJETOS, no contenido de tablas, así que un .down que se olvide esta línea
-- pasa la comparación. Y `check_drift.sh` lee esta tabla para decidir qué falta
-- aplicar: con la fila puesta y el esquema revertido, informaría «no falta
-- ninguna» sobre una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0026_company_profile';

-- El permiso se consume: vale para UNA corrida, igual que en el `.down` de la
-- `0027`. Dentro de la transacción: si algo de arriba falla, el permiso queda
-- para reintentar.
RESET vulkan.perder_la_ficha;

COMMIT;
