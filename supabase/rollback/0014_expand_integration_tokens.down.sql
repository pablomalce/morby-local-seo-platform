-- 0014_expand_integration_tokens.down.sql — la vuelta atrás de la 0014.
--
-- La 0014 sólo AGREGA, así que deshacerla es tirar lo que agregó. El orden es el
-- inverso del de la migración por la misma razón que en la 0013: la tabla
-- arrastra sus policies e índices al caer, pero la función es independiente y se
-- tira aparte.
--
-- LO QUE ESTE .down NO BORRA, Y ES DELIBERADO: LOS SECRETOS
--
-- Las filas de `vault.secrets` quedan donde están. Podría parecer un descuido y
-- es lo contrario:
--
--   * la FK es ON DELETE RESTRICT, o sea que el Vault no se entera de que la
--     tabla se fue, y borrarlo a mano acá dejaría a un `.down` destruyendo
--     secretos como efecto secundario de revertir un esquema;
--   * y volver atrás es, por definición, algo que se hace cuando algo salió mal.
--     Si además se llevara puestos los tokens de todos los clientes, la ruta de
--     retorno costaría que cada uno vuelva a conectar su cuenta de Google. Una
--     salida de emergencia que cobra ese peaje no se usa: se improvisa otra cosa
--     a las tres de la mañana.
--
-- Quedan huérfanos, sí, y por eso se dice acá en vez de descubrirse después. Se
-- listan con:
--
--     SELECT id, name, created_at FROM vault.secrets
--      WHERE name LIKE 'integration_token/%';
--
-- Limpiarlos es una decisión aparte, con su propia migración y su propio aviso.
-- `schema_fingerprint.sql` compara objetos del esquema, así que no los ve, y
-- este comentario es lo único que los declara.

\set ON_ERROR_STOP on

-- La tabla se lleva con ella sus dos policies, sus dos índices, su CHECK y su
-- FK. Nombrarlas una por una antes sería escribir de más y arriesgarse a que la
-- lista quede desactualizada respecto de la migración.
DROP TABLE IF EXISTS public.integration_tokens;

-- Después de la tabla: hoy nada más la nombra, pero el orden inverso al de la
-- migración es el que sigue siendo correcto si mañana una policy la usa.
DROP FUNCTION IF EXISTS public.integration_token_state(timestamptz, timestamptz);

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0014_expand_integration_tokens';
