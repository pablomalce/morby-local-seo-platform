-- Revierte la 0026.
--
-- QUÉ SE PIERDE
--
-- Las ocho tablas y con ellas TODA la ficha de todos los clientes: oferta,
-- mercados, segmentos, competidores curados, ICP, objetivos y evidencia. A
-- diferencia del .down de la `0025` —que pierde mediciones reproducibles
-- corriendo la auditoría de nuevo— lo que se pierde acá es TRABAJO HUMANO que
-- nadie puede regenerar. Si hay una sola versión publicada, esto no se corre sin
-- un export previo.
--
-- El proyecto hosted de este repositorio vive en el tier gratuito de Supabase,
-- que no tiene backups automáticos ni PITR. O sea que «exportar antes» no es una
-- recomendación: es la única red que hay (§12.15 del director: un respaldo no
-- probado no es un respaldo).
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

COMMIT;
