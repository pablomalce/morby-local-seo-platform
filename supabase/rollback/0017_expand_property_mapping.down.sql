-- 0017_expand_property_mapping.down.sql — la vuelta atrás de la 0017.
--
-- La 0017 sólo AGREGA una tabla, así que deshacerla es tirarla. No hay función
-- ni índice sobre tablas ajenas —a diferencia de la 0016, que tuvo que crear un
-- índice único en `content_assets` para poder referenciarlo— así que no queda
-- nada afuera de la tabla que haya que nombrar aparte.
--
-- LO QUE SE LLEVA, Y HAY QUE LEERLO ANTES
--
-- La correspondencia entre cada cliente y su property de GA4, su sitio de Search
-- Console y su ficha de GBP. Los permisos delegados sobre la cuenta de Vulkan
-- SIGUEN otorgados —eso vive del lado de Google— y lo que se pierde es saber cuál
-- es de quién.
--
-- Eso convierte la vuelta atrás en algo peor que "quedarse sin la función": deja
-- el sistema con un token que alcanza a las propiedades de todos los clientes y
-- sin la tabla que decía cuál mirar para cada uno. Rehacer el mapeo a mano es
-- exactamente la operación donde un error produce la fuga que la 0017 existe para
-- impedir, y hacerla a las tres de la mañana después de un rollback es la peor
-- circunstancia posible para hacerla.
--
-- Así que antes de correr esto sobre una base con mapeos reales:
--
--     CREATE TABLE mapeos_respaldo AS SELECT * FROM public.integration_properties;
--
-- El respaldo no es ceremonia: el proyecto hosted está en el tier gratuito de
-- Supabase, que no tiene backups automáticos ni PITR. Lo dice el encabezado de
-- rollback.sh y vale doble para esta tabla.
--
-- No hay nada que preservar en `vault.secrets` en este caso, a diferencia de la
-- 0014: esta tabla no guarda ni referencia ningún secreto.

\set ON_ERROR_STOP on

-- La tabla se lleva con ella sus dos policies, sus tres índices, sus dos CHECK y
-- su FK. Nombrarlas una por una antes sería escribir de más y arriesgarse a que
-- la lista quede desactualizada respecto de la migración.
DROP TABLE IF EXISTS public.integration_properties;

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0017_expand_property_mapping';
