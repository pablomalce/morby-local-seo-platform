-- Revierte la 0025.
--
-- Borra la tabla y con ella TODAS las auditorías guardadas. Es un rollback de
-- esquema que sí pierde datos, y conviene decirlo acá en vez de descubrirlo
-- después: lo que se pierde es historia de mediciones, reproducible corriendo la
-- auditoría de nuevo. Nada de lo que se pierde es dato de un cliente.
--
-- Las políticas y los grants se van con la tabla. No se revocan a mano: hacerlo
-- dejaría este archivo fallando la segunda vez que se corra.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public.aeo_audits;

DELETE FROM public.schema_migrations WHERE version = '0025_aeo_audits';
