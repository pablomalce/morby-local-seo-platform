-- 0030_pagespeed_cache_server_only.sql — la caché de PageSpeed es de cada
-- organización, y la leen y la escriben sólo el servidor.
--
-- QUÉ IMPIDE
--
-- Cuatro cosas. Las dos primeras, medidas en producción (`tpqiltnskfeycnybczgz`)
-- el 2026-10-06; las otras dos, en la réplica el 2026-10-07, sobre la primera
-- versión de este mismo arreglo:
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
--      cliente sin volver a preguntarle a Google.
--
--   3. QUE EL SERVIDOR CONTESTE POR LA CACHÉ DE OTRO. Cerrar la tabla al
--      cliente y dejársela al servidor no alcanzaba con la clave por URL sola:
--      `service_role` saltea la RLS, y la URL la elige quien pide el reporte —
--      por `clientSnapshot`, o creando en su organización recién dada de alta un
--      negocio con esa web, que la RLS de `businesses` le deja hacer (medido como
--      `authenticated`: `INSERT 0 1`)—. El servidor le contestaba desde la caché
--      del cliente, sin llamar a Google, en milisegundos y con el `fetchedAt` de
--      su último reporte: un oráculo de «¿esta URL es cliente, y cuándo lo
--      miraron?». La clave pasa a ser `(organization_id, url, strategy)`.
--
--   4. QUE UNA FILA ENVENENADA ANTES DE ESTO SE SIRVA PARA SIEMPRE. Quien
--      escribía la fila elegía su `fetched_at`, y con uno futuro la cuenta de la
--      edad da negativa: «fresca» sin vencimiento. Medido: una fila con
--      `fetched_at = 2999-01-01` escrita como `authenticated` sobrevivía a la
--      primera versión de esta migración, y `service_role` la leía como fresca.
--      Esta la BORRA (decisión 1), y el orquestador ya no sirve un `fetched_at`
--      futuro aunque alguien lo vuelva a escribir.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 136 a 143 de `supabase/qa/defects_test.sql`:
--
--   * el 136 y el 137: `anon` no lee ni escribe, por PRIVILEGIO de tabla y de
--     COLUMNA (catálogo) y por INTENTO (un SELECT, un upsert y un INSERT
--     reales como `anon`, que tienen que morir con el 42501 del privilegio, no
--     con el de una policy);
--   * el 138 y el 139: lo mismo para `authenticated`, con una identidad puesta
--     desde `auth_stub.sql` como en los otros bloques —el 139 es el
--     envenenamiento medido arriba, ejecutado—;
--   * el 140: ninguna policy de la tabla alcanza a PUBLIC, `anon` o
--     `authenticated`, ningún privilegio de tabla ni de columna queda en
--     PUBLIC, `anon`, `authenticated` ni `growthos_app`, y la RLS sigue ENABLE
--     y FORCE. Es la segunda capa: la que sigue cerrada el día que alguien
--     devuelva un GRANT;
--   * el 141, el control positivo: `service_role` lee la fila, la upsertea por
--     la clave nueva, y guarda la MISMA URL para otra organización sin chocar.
--     Sin él, una migración que cerrara la tabla para todos —incluido el
--     servidor— pondría del 136 al 140 en verde con la caché muerta;
--   * el 142: nada más en la base alcanza la tabla —ninguna vista, regla,
--     función ni FK de otra tabla la nombra—. `postgres` tiene BYPASSRLS y los
--     default privileges dan EXECUTE y SELECT a `anon` en todo lo nuevo de
--     `public`, así que una función SECURITY DEFINER o una vista sobre esta
--     tabla reabren la lectura y la escritura sin un solo GRANT. Lleva su propio
--     control: arma los cuatro caminos en una subtransacción y exige verlos;
--   * el 143: la baja de una organización se lleva su caché, por la FK.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-07), una mutación por vez sobre una base con las
-- migraciones hasta la `0028`, aplicando esta mutada y después `app_role.sql`,
-- y corriendo el archivo entero (128 aserciones). Ninguna sobrevivió:
--
--   sin esta migración (el esquema de main) . . . . . el archivo ABORTA en la
--       fixture del 136: «column organization_id does not exist»
--   queda la policy de lectura a PUBLIC . . . . . . . rojo 140
--   quedan las dos policies de escritura  . . . . . . rojo 140
--   el REVOKE se olvida de anon . . . . . . . . . . . rojo 136, 137, 140
--   el REVOKE se olvida de authenticated  . . . . . . rojo 138, 139, 140
--   una lista a mano (SELECT, INSERT, UPDATE, DELETE)
--       en vez de ALL . . . . . . . . . . . . . . . . rojo 137, 139, 140
--   el servidor sin su GRANT  . . . . . . . . . . . . rojo 141
--   el servidor sin DELETE  . . . . . . . . . . . . . rojo 141
--   NO FORCE  . . . . . . . . . . . . . . . . . . . . rojo 6, 140
--   DISABLE ROW LEVEL SECURITY  . . . . . . . . . . . rojo 140
--   GRANT SELECT + una permisiva de lectura
--       para authenticated  . . . . . . . . . . . . . rojo 138, 140
--   la clave primaria sigue siendo (url, strategy)  . rojo 137, 139, 141
--   la FK sin ON DELETE CASCADE . . . . . . . . . . . rojo 143
--   sin la FK . . . . . . . . . . . . . . . . . . . . rojo 143
--   `app_role.sql` sin su REVOKE a growthos_app . . . rojo 140
--
-- Con esta migración puesta y una sentencia más después —las que mostraron que
-- la primera versión de la suite no veía todo, más tres vecinas—:
--
--   INSERT por columna a anon y authenticated . . . . rojo 137, 139, 140
--   UPDATE por columna a authenticated, REFERENCES
--       por columna a anon, INSERT por columna a PUBLIC  rojo 137, 139, 140
--   SELECT (url) a anon . . . . . . . . . . . . . . . rojo 136, 140
--   una función SECURITY DEFINER que lee y otra
--       que upsertea  . . . . . . . . . . . . . . . . rojo 142
--   una vista con SELECT para anon y authenticated  . rojo 142
--   una INVOKER que nombra la tabla, llamada desde
--       una DEFINER que no la nombra  . . . . . . . . rojo 142
--   una FK de otra tabla a ésta . . . . . . . . . . . rojo 12, 14, 142
--
-- Y el detector del 142 a ciegas, una rama por vez —sin `prosrc`, sin
-- `pg_depend` de funciones, sin vistas, sin FK—: rojo 142 por su propio control.
--
-- Lo que la suite NO puede ver, medido aparte con datos: sin el DELETE, sobre
-- una base con la fila envenenada del punto 4, la migración ABORTA con 23502
-- («column "organization_id" ... contains null values») y no queda nada
-- registrado; con él, la fila desaparece. Sacar el NOT NULL además del DELETE
-- es un mutante equivalente: la clave primaria pone NOT NULL igual.
--
-- Y el `.down`, con `rollback.sh`: huella idéntica (1010 objetos). Sin el
-- DELETE del registro, sin el ALL del servidor, sin REFERENCES y TRIGGER de
-- `anon`, con la lectura `TO authenticated`, sin volver a la clave `(url,
-- strategy)` o sin sacar la columna: rojo. Sin su DELETE de filas, con dos
-- organizaciones con la misma URL en la caché: aborta con 23505 y no deja nada
-- a medias.
--
-- LAS DECISIONES
--
-- 1. SE BORRA TODO LO QUE HAY. Las filas no tienen organización —la tabla no
--    tenía eje de tenant—, cualquiera pudo haber escrito cualquiera de ellas, y
--    algunas pueden tener un `fetched_at` futuro (QUÉ IMPIDE, 4). No hay forma
--    de distinguir una buena de una envenenada, ni de saber de qué
--    organización es una URL que dos podrían compartir. Es una caché: lo que
--    cuesta es UNA consulta a Google por sitio en el próximo reporte. Y la
--    columna NOT NULL lo exige: sin el DELETE, la migración aborta.
--
-- 2. `organization_id` NOT NULL, CON FK A `organizations` Y `ON DELETE
--    CASCADE`, Y AL FRENTE DE LA CLAVE PRIMARIA. Cada organización tiene su
--    entrada por URL y estrategia, y sólo la suya. El orquestador la lee
--    filtrando por la organización del negocio que la sesión leyó de la base
--    —nunca por algo del pedido— y sin organización (demo, `clientSnapshot`)
--    no la toca. La cascada es la de `integration_probe` (`0022`): la baja de
--    un cliente se lleva sus URLs, que hasta esto quedaban en la tabla para
--    siempre. FK simple y no compuesta: la tabla no cuelga de un negocio
--    —dos negocios de una organización con la misma web comparten la entrada,
--    y está bien—, así que no hay `business_id` con quien atarla.
--
-- 3. SIN POLICIES, Y CON LA RLS PUESTA. Con RLS ENABLE + FORCE y cero policies,
--    todo rol sin BYPASSRLS ve cero filas y no escribe ninguna. `service_role`
--    —y `postgres`, el del editor SQL, medido: `rolbypassrls = t` en la imagen
--    de Supabase— no se enteran. Escribir una policy `TO service_role` sería
--    decorar: BYPASSRLS no la consulta. El asesor de Supabase marca «RLS sin
--    policies» como INFO; acá es la intención y no un olvido.
--
-- 4. `REVOKE ALL`, NO UNA LISTA. Los default privileges de Supabase dan los
--    siete privilegios por NOMBRE —y MAINTAIN desde el 17—, así que `anon`
--    tenía SELECT, REFERENCES y TRIGGER, y `authenticated` además INSERT,
--    UPDATE y DELETE (medido en la réplica antes de esto). Una lista escrita a
--    mano deja afuera el que nadie se acordó de nombrar. `FROM PUBLIC` no
--    alcanza: lo dice la `0022`. Y el REVOKE de tabla se lleva también los
--    privilegios de COLUMNA que hubiera (medido: `attacl` vacío después).
--
-- 5. `service_role` QUEDA CON SELECT, INSERT, UPDATE Y DELETE, como las otras
--    tablas de servidor (`0022`, `0025`). El upsert de PostgREST es un `INSERT
--    ... ON CONFLICT DO UPDATE` y necesita los tres primeros; DELETE es para
--    purgar entradas viejas sin pedir otra migración. Pierde TRUNCATE,
--    REFERENCES, TRIGGER y MAINTAIN, que nadie usa.
--
-- 6. `growthos_app` NO SE NOMBRA ACÁ. Es el rol con el que la suite hace de
--    aplicación, y su alcance lo decide `supabase/qa/app_role.sql`, que le
--    revoca TODO sobre esta tabla —como a `ingest_events`— por el motivo de
--    siempre: si la suite midiera con un rol más laxo que la sesión real,
--    pasaría en verde por tener un privilegio de más.
--
-- 7. EL `FORCE` YA ESTABA. Lo puso la `0003` en el bucle sobre toda tabla con
--    RLS, y la réplica lo confirma (`relforcerowsecurity = t` antes de esto). Se
--    vuelve a escribir para que esta migración sola diga el estado completo de
--    la tabla, sin depender de que alguien recuerde un bucle de hace 27
--    migraciones. Es idempotente, y por eso el `.down` no lo deshace.
--
-- QUÉ NO HACE
--
-- * NO CIERRA EL ALTA DE CUENTAS. Sigue abierta; esto hace que estar registrado
--   deje de alcanzar para tocar la caché de otro, que es lo que importa acá.
--
-- * NO LE PONE LÍMITE AL LARGO DE `url`. La escribe sólo el servidor, con la
--   web del negocio de la propia organización; una URL de más de ~2700 bytes
--   no entra en el índice de la clave, el upsert falla, queda en el log y el
--   reporte sale igual.
--
-- ORDEN DE DESPLIEGUE: CUALQUIERA ANDA, Y CONVIENE ESTA PRIMERO
--
-- Ninguna combinación rompe un reporte; lo que cambia es cuánto tiempo la
-- caché no sirve y cuánto queda abierta la tabla.
--
--   * Esta migración con el código VIEJO: el código viejo lee y escribe con la
--     sesión, y esta tabla le contesta 42501 a las dos cosas; él lo ignora y
--     trata la lectura como «no hay caché». Cada reporte va a Google.
--   * El código NUEVO sin esta migración: lee filtrando por `organization_id`,
--     que todavía no existe (42703, al log), y su upsert la nombra (PGRST204, al
--     log). Cada reporte va a Google.
--
-- En los dos casos la cuota se gasta hasta que llegue la otra mitad. Pero sólo
-- en el primero la lista de clientes ya está cerrada: aplicar esto PRIMERO en
-- hosted cierra el agujero medido en producción sin esperar al deploy.
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
-- saltea (decisión 3).
DROP POLICY IF EXISTS "pagespeed_cache_select" ON public.pagespeed_cache;
DROP POLICY IF EXISTS "pagespeed_cache_insert" ON public.pagespeed_cache;
DROP POLICY IF EXISTS "pagespeed_cache_update" ON public.pagespeed_cache;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que hay, fuera (decisión 1)
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.pagespeed_cache;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La organización, en la fila y en la clave (decisión 2)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pagespeed_cache
    ADD COLUMN organization_id uuid NOT NULL
        CONSTRAINT pagespeed_cache_organization_id_fkey
        REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.pagespeed_cache DROP CONSTRAINT pagespeed_cache_pkey;
ALTER TABLE public.pagespeed_cache
    ADD CONSTRAINT pagespeed_cache_pkey PRIMARY KEY (organization_id, url, strategy);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La RLS, dicha entera (decisión 7)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pagespeed_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagespeed_cache FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El privilegio: nadie, y después el servidor (decisiones 4 y 5)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.pagespeed_cache FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagespeed_cache TO service_role;

-- La columna y la clave cambiaron: PostgREST tiene que volver a leer el esquema
-- para que el upsert del orquestador la vea, y la `0002` lo pidió por lo mismo
-- para esta tabla. Dentro de la transacción, un NOTIFY se entrega recién al
-- COMMIT: si algo de arriba falla, no sale.
NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (version) VALUES ('0030_pagespeed_cache_server_only')
ON CONFLICT (version) DO NOTHING;

COMMIT;
