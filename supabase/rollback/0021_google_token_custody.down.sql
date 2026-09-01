-- 0021_google_token_custody.down.sql — la vuelta atrás de la 0021.
--
-- La 0021 sólo agrega tres funciones. Deshacerla es tirarlas, y no se lleva
-- ningún dato: los tokens ya guardados siguen en `integration_tokens` y sus
-- secretos siguen cifrados en `vault.secrets`. Nada de eso depende de estas
-- funciones para existir.
--
-- LO QUE SE PIERDE, Y HAY QUE LEERLO ANTES
--
-- El único camino de escritura y el único de lectura que la aplicación tiene
-- hacia el Vault. Después de correr esto, Growth OS puede seguir diciendo en qué
-- estado está el token —`integration_token_state()` es de la 0014 y mira dos
-- fechas— y NO puede ni guardarlo, ni refrescarlo, ni usarlo. La pantalla de
-- integraciones sigue andando; el OAuth y los reportes con datos de Google no.
--
-- Lo que NO hay que hacer es reemplazarlas «provisoriamente» con dos llamadas
-- desde TypeScript: `supabase-js` no llega al esquema `vault`, así que la única
-- manera de escribir un token sin estas funciones es guardarlo en claro en
-- alguna columna de `public`. Eso es el defecto que la 0014 existe para impedir,
-- y una vez que hay tokens reales adentro ya no se arregla cifrando: se arregla
-- rotando todos los tokens con cada cliente.
--
-- Después de correr esto, el camino honesto es dejar el OAuth apagado.
--
-- Y los secretos huérfanos, que no los hay. Un secreto sólo queda sin fila si su
-- fila se borra, y la foránea de la 0014 es RESTRICT en la otra dirección. Esto
-- no borra ninguna fila.

\set ON_ERROR_STOP on

-- Las firmas completas, y no el nombre a secas: si mañana existe una sobrecarga,
-- la versión corta falla con `function name is not unique` y la larga se lleva
-- exactamente la que esta migración creó.
DROP FUNCTION IF EXISTS public.integration_token_secret(uuid, text);
DROP FUNCTION IF EXISTS public.refresh_integration_token(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.store_integration_token(uuid, text, text, timestamptz);

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0021_google_token_custody';
