-- 0030_pagespeed_cache_server_only.sql — la caché de PageSpeed la leen y la escriben sólo el servidor.
--
-- QUÉ IMPIDE
--
-- Dos cosas, medidas en producción (`tpqiltnskfeycnybczgz`) el 2026-10-06:
--
--   1. QUE CUALQUIERA EN INTERNET LEA LA LISTA DE CLIENTES. `GET
--      /rest/v1/pagespeed_cache?select=url` con la clave publishable —que viaja
--      en el bundle del navegador— devolvió filas. La clave de la tabla es la URL
--      del sitio analizado, y los sitios analizados son los de los clientes. La
--      `0002` y la `0005` dejaron el SELECT abierto a PUBLIC «a propósito» porque
--      los puntajes de PageSpeed de un sitio público no son secretos. Los
--      puntajes no; QUIÉNES son los clientes, sí, y la columna `url` lo dice.
--
--   2. QUE CUALQUIERA QUE SE REGISTRE ESCRIBA EL REPORTE DE OTRO. La `0005` le
--      sacó la escritura a `anon` y se la dejó a `authenticated` con
--      `WITH CHECK (true)`, con este argumento: «cada escritura legítima ya
--      llega como `authenticated`». Era cierto y no alcanzaba, porque el alta de
--      cuentas está ABIERTA —`GET /auth/v1/settings` contestó
--      `disable_signup: false`, el mismo día—. `authenticated` no es «un
--      cliente»: es cualquiera con un correo. Esa persona upsertea un resultado
--      inventado para la URL de un cliente, y `hydrateWithPageSpeed()`
--      (`src/lib/reports/orchestrator.ts`) lo sirve 24 h en el reporte de ese
--      cliente sin volver a preguntarle a Google. Entre organizaciones: la
--      tabla no tiene eje de tenant, así que ninguna policy podía separarlas.
--
-- El arreglo no es una policy mejor. Es que ni `anon` ni `authenticated`
-- alcancen la tabla de ninguna forma: el orquestador la lee y la escribe con
-- `service_role` (`createSupabaseAdminClient`), del lado del servidor, y lo que
-- escribe es lo que Google le contestó a él, nunca algo que vino en el pedido.
-- Es el trato que ya tienen `ingest_events` (`0018`) y `schema_migrations`
-- (`0009`): tablas de la plataforma, no del cliente.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 136 a 141 de `supabase/qa/defects_test.sql`:
--
--   * el 136 y el 137: `anon` no lee ni escribe, por PRIVILEGIO (catálogo) y por
--     INTENTO (un SELECT y un upsert reales como `anon`, que tienen que morir con
--     42501);
--   * el 138 y el 139: lo mismo para `authenticated`, con una identidad puesta
--     desde `auth_stub.sql` como en los otros bloques —el 139 es el
--     envenenamiento medido arriba, ejecutado—;
--   * el 140: ninguna policy de la tabla alcanza a PUBLIC, `anon` o
--     `authenticated`, ningún privilegio queda en PUBLIC ni en `growthos_app`, y
--     la RLS sigue ENABLE y FORCE. Es la segunda capa: la que sigue cerrada el
--     día que alguien devuelva un GRANT;
--   * el 141, el control positivo: `service_role` lee la fila y la upsertea. Sin
--     él, una migración que cerrara la tabla para todos —incluido el servidor—
--     pondría del 136 al 140 en verde con la caché muerta.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-06), una mutación por vez sobre una base con las
-- migraciones hasta la `0028`, aplicando esta mutada y después `app_role.sql`,
-- y corriendo el archivo entero (126 aserciones). Ninguna sobrevivió:
--
--   sin esta migración (el esquema de main) . . . . . rojo 136 a 140
--       anon leyó 1 fila; el upsert de la recién registrada fue ACEPTADO
--   queda la policy de lectura a PUBLIC . . . . . . . rojo 140
--   quedan las dos policies de escritura  . . . . . . rojo 140
--   el REVOKE se olvida de anon . . . . . . . . . . . rojo 136, 137
--   el REVOKE se olvida de authenticated  . . . . . . rojo 138, 139
--       el upsert murió con 42501 «new row violates row-level security
--       policy»: la RLS conteniendo un privilegio que sobra, y el 139 lo ve
--       porque afirma el MENSAJE y no sólo el código
--   una lista a mano (SELECT, INSERT, UPDATE, DELETE)
--       en vez de ALL . . . . . . . . . . . . . . . . rojo 137, 139
--       (quedan REFERENCES y TRIGGER)
--   el servidor sin su GRANT  . . . . . . . . . . . . rojo 141
--   el servidor sin DELETE  . . . . . . . . . . . . . rojo 141
--   NO FORCE  . . . . . . . . . . . . . . . . . . . . rojo 6, 140
--   DISABLE ROW LEVEL SECURITY  . . . . . . . . . . . rojo 140
--   GRANT SELECT + una permisiva de lectura
--       para authenticated  . . . . . . . . . . . . . rojo 138, 140
--   `app_role.sql` sin su REVOKE a growthos_app . . . rojo 140
--
-- Y el `.down`, con `rollback.sh`: huella idéntica (1010 objetos); sin el
-- DELETE del registro, sin el ALL del servidor, sin la lectura de `anon` o con
-- la policy de lectura `TO authenticated` en vez de PUBLIC, rojo.
--
-- LAS DECISIONES
--
-- 1. SIN POLICIES, Y CON LA RLS PUESTA. Con RLS ENABLE + FORCE y cero policies,
--    todo rol sin BYPASSRLS ve cero filas y no escribe ninguna. `service_role`
--    —y `postgres`, el del editor SQL, medido: `rolbypassrls = t` en la imagen
--    de Supabase— no se enteran. Escribir una policy `TO service_role` sería
--    decorar: BYPASSRLS no la consulta. El asesor de Supabase marca «RLS sin
--    policies» como INFO; acá es la intención y no un olvido.
--
-- 2. `REVOKE ALL`, NO UNA LISTA. Los default privileges de Supabase dan los
--    siete privilegios por NOMBRE —y MAINTAIN desde el 17—, así que `anon`
--    tenía SELECT, REFERENCES y TRIGGER, y `authenticated` además INSERT,
--    UPDATE y DELETE (medido en la réplica antes de esto). Una lista escrita a
--    mano deja afuera el que nadie se acordó de nombrar. `FROM PUBLIC` no
--    alcanza: lo dice la `0022`.
--
-- 3. `service_role` QUEDA CON SELECT, INSERT, UPDATE Y DELETE, como las otras
--    tablas de servidor (`0022`, `0025`). El upsert de PostgREST es un `INSERT
--    ... ON CONFLICT DO UPDATE` y necesita los tres primeros; DELETE es para
--    purgar entradas viejas sin pedir otra migración. Pierde TRUNCATE,
--    REFERENCES, TRIGGER y MAINTAIN, que nadie usa.
--
-- 4. `growthos_app` NO SE NOMBRA ACÁ. Es el rol con el que la suite hace de
--    aplicación, y su alcance lo decide `supabase/qa/app_role.sql`, que le
--    revoca TODO sobre esta tabla —como a `ingest_events`— por el motivo de
--    siempre: si la suite midiera con un rol más laxo que la sesión real,
--    pasaría en verde por tener un privilegio de más.
--
-- 5. EL `FORCE` YA ESTABA. Lo puso la `0003` en el bucle sobre toda tabla con
--    RLS, y la réplica lo confirma (`relforcerowsecurity = t` antes de esto). Se
--    vuelve a escribir para que esta migración sola diga el estado completo de
--    la tabla, sin depender de que alguien recuerde un bucle de hace 27
--    migraciones. Es idempotente, y por eso el `.down` no lo deshace.
--
-- QUÉ NO HACE
--
-- * NO BORRA LAS FILAS. Las URLs siguen en la tabla; lo que cambia es quién las
--   alcanza. Las que alguien haya envenenado antes de esto siguen ahí hasta 24 h
--   después de su `fetched_at`, y después el orquestador las pisa con lo que
--   conteste Google. Purgarlas es una decisión aparte: `DELETE FROM
--   public.pagespeed_cache` como `postgres` cuesta, a lo sumo, una consulta a
--   Google por sitio en el reporte siguiente.
--
-- * NO CIERRA EL ALTA DE CUENTAS. Sigue abierta; esto hace que estar registrado
--   deje de alcanzar para tocar la caché, que es lo que importa acá.
--
-- ORDEN DE DESPLIEGUE: EL CÓDIGO PRIMERO
--
-- El orquestador nuevo lee y escribe con `service_role`, que tiene ALL desde la
-- `0010`: funciona con esta migración y sin ella. El VIEJO usa la sesión: con
-- esta migración puesta y el código viejo desplegado, su SELECT muere con 42501
-- —que él ignora y trata como «no hay caché»— y su upsert también. No se cae
-- ningún reporte, pero cada uno vuelve a consultar a Google: la cuota se gasta
-- hasta que llegue el código. Por eso: mergear y desplegar el código, y DESPUÉS
-- aplicar esto en hosted.
--
-- VUELTA ATRÁS: `supabase/rollback/0030_pagespeed_cache_server_only.down.sql`.
-- REABRE el agujero —es lo que significa revertir—, y lo dice su encabezado.

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Las tres policies, fuera
-- ─────────────────────────────────────────────────────────────────────────────
-- La de lectura aplicaba a PUBLIC (`0002`); las de escritura, a `authenticated`
-- (`0005`). Ninguna se reemplaza: sin policies, la RLS niega todo a quien no la
-- saltea (decisión 1).
DROP POLICY IF EXISTS "pagespeed_cache_select" ON public.pagespeed_cache;
DROP POLICY IF EXISTS "pagespeed_cache_insert" ON public.pagespeed_cache;
DROP POLICY IF EXISTS "pagespeed_cache_update" ON public.pagespeed_cache;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La RLS, dicha entera (decisión 5)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pagespeed_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagespeed_cache FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El privilegio: nadie, y después el servidor (decisiones 2 y 3)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.pagespeed_cache FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagespeed_cache TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0030_pagespeed_cache_server_only')
ON CONFLICT (version) DO NOTHING;

COMMIT;
