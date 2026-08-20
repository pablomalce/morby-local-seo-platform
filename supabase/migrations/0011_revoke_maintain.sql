-- 0011_revoke_maintain.sql — MAINTAIN fuera del alcance de la llave pública.
--
-- QUÉ CIERRA, Y CÓMO APARECIÓ
--
-- Lo encontró el job de deriva en su primera corrida útil, que es exactamente
-- para lo que se escribió: hosted tenía 285 grants de tabla y el repositorio
-- construía 255. Las treinta de diferencia eran `MAINTAIN` para `anon` y para
-- `authenticated` sobre las quince tablas.
--
-- MAINTAIN es un privilegio nuevo de PostgreSQL 17. Habilita VACUUM, ANALYZE,
-- REINDEX, CLUSTER y REFRESH MATERIALIZED VIEW sobre la tabla. No deja leer ni
-- escribir una fila, así que esto no es una fuga de datos — es trabajo de
-- mantenimiento que puede disparar cualquiera que tenga el privilegio, y `anon`
-- es la llave que viaja en el bundle del navegador.
--
-- Por qué el repositorio no lo tenía y hosted sí: la 0010 le da a `service_role`
-- un `GRANT ALL`, que en 17 incluye MAINTAIN, y a los otros dos les da
-- privilegios nombrados donde MAINTAIN no está. Los default privileges de
-- Supabase, en cambio, se lo dieron a los tres. Por eso `service_role` coincidía
-- de los dos lados y `anon` y `authenticated` no.
--
-- Primera vez que el job de deriva encuentra algo que nadie había ido a buscar.
--
-- UNA ACLARACIÓN SOBRE LA CORRIDA ANTERIOR
--
-- Antes de esto, el mismo job reportaba 45 diferencias de MAINTAIN y sí eran
-- ruido: el runner corría PostgreSQL 16, donde el privilegio no existe. Eso se
-- arregló poniendo 17 en los tres lugares. Las treinta que quedaron después son
-- las de verdad, y son estas.

\set ON_ERROR_STOP on

REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('0011_revoke_maintain')
ON CONFLICT (version) DO NOTHING;
