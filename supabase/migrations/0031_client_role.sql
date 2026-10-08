-- 0031_client_role.sql — el rol de cliente deja de ser cosmético (puerta H4.1).
--
-- QUÉ AGREGA
--
-- Medido en hosted el 2026-10-07 sobre `pg_policies`: las policies `*_rw_member`
-- de la 0001 —y las que la 0004 reescribió con el mismo molde— son `FOR ALL` con
-- `organization_id IN current_user_org_ids()` y NO MIRAN EL ROL. Cualquier
-- miembro activo, un `viewer` incluido, escribe y borra; y `authenticated` tiene
-- INSERT/UPDATE/DELETE de tabla en casi todas. O sea que `org_members.role` era
-- una palabra: la base no la leía en ningún lado salvo para administrar miembros
-- (`current_user_admin_org_ids()`, 0013).
--
-- Esta migración agrega cuatro cosas, y ninguna alcanza sola:
--
--   1. el rol `client` en el CHECK de `org_members.role`;
--   2. tres funciones que dicen QUIÉN, cada conjunto de roles en un solo lugar:
--        current_user_writer_org_ids()    owner, admin, manager, editor
--        current_user_staff_org_ids()     owner, admin, manager, editor, viewer
--        current_user_approver_org_ids()  owner, admin, manager
--      Las tres listan los roles que SÍ, no los que no: un rol que se agregue
--      mañana al CHECK nace sin escribir, sin ver lo interno y sin aprobar, que es
--      la dirección barata del error;
--   3. `is_internal_surface(tabla)`, el ÚNICO lugar donde una tabla se declara
--      interna (ver «LA REGLA DE LO INTERNO» abajo);
--   4. el EJE DE ROL, por catálogo: a toda tabla de `public` con
--      `organization_id` y RLS que una SESIÓN alcanza —tiene alguna permisiva
--      para PUBLIC, `anon` o `authenticated`— se le ponen tres policies
--      RESTRICTIVE —INSERT, UPDATE, DELETE— que exigen un rol que escribe, y a
--      las internas una cuarta, de SELECT, que exige personal de la agencia.
--      Restrictivas y no un cambio a las permisivas, por lo que la 0014 y la 0016
--      ya escribieron: una permisiva se ensancha agregando otra permisiva; una
--      restrictiva no. Las permisivas de la 0001/0004 quedan como estaban y
--      siguen decidiendo el TENANT; el eje decide el ROL, y las dos se
--      multiplican.
--
--      La tabla que ninguna sesión alcanza queda SIN eje, y es a propósito. Hoy
--      es una: `pagespeed_cache`, que la 0030 dejó sólo para el servidor —RLS
--      FORCE, cero policies, cero privilegios para las sesiones—. Ahí no hay
--      nada que el rol pueda restringir (con RLS y sin permisiva, nadie lee ni
--      escribe), y su bloque 140 exige que NINGUNA policy alcance a PUBLIC,
--      `anon` o `authenticated`: una restrictiva de más la pondría en rojo sin
--      cerrar nada. Si mañana alguien le da una permisiva de sesión, el bloque
--      208 la encuentra sin eje y se pone rojo hasta que se re-aplique esto.
--
-- Y una quinta, más chica: el eje de APROBACIÓN sobre `content_assets`. Una fila
-- sellada (`approved_hash` no nulo) sólo la puede insertar, sellar, tocar sin
-- soltarle el sello o BORRAR quien aprueba (decisión D4). Sin esto, la regla de
-- quién aprueba viviría sólo en `/api/content/approve`, y un editor la saltea
-- con un UPDATE por PostgREST; y sin la policy de DELETE —que la primera versión
-- no tenía— un editor borraba el asset sellado y la cascada de la 0016 se
-- llevaba su fila del ledger (ver la sección 5).
--
-- CÓMO FALLA (lo que la suite mide, bloques 200 a 216 de defects_test.sql)
--
-- La puerta: un usuario con rol de cliente en la organización X, autenticado de
-- verdad, VE los datos de X; y las tres acciones prohibidas —leer otra
-- organización, modificar integraciones, aprobar una publicación— dejan CERO
-- filas cambiadas por PostgREST, no sólo cuando falta el botón. Rojo si:
--
--   * el rol se agrega al CHECK y NINGUNA policy lo distingue de `viewer`
--     (bloques 201, 204 y 208: la mutación S01 de abajo); o se lo «distingue»
--     escondiendo lo interno a todo el que no escribe, viewer incluido
--     (bloque 202);
--   * la restricción vive sólo en la pantalla o en la ruta: los bloques miden
--     como `authenticated`, por PostgREST, sin pasar por ninguna de las dos;
--   * la lectura propia devuelve cero: un rol que no sirve (bloque 200);
--   * la negativa sale por estar en OTRA organización y no por el rol. La
--     corrección del crítico: cada sentencia que el client no puede ejecutar se
--     ejecuta IGUAL con el manager de la MISMA organización, y tiene que cambiar
--     la fila (bloque 205);
--   * el eje de aprobación mira el estado y no el sello (bloque 211, con
--     `scheduled` y `published`), o no cubre el DELETE (bloque 216);
--   * una de las tres funciones no fija su `search_path` (214) o está escrita
--     como lista de exclusión: un rol que se agregue mañana nacería con permisos
--     (215, que da de alta un rol `futuro` y le pregunta a las tres).
--
-- Lo que la base NO puede ver es la ruta: aprobar por `/api/content/approve` y
-- publicar por `/api/publishing/*` corren con `service_role` para el ledger, y
-- mapear propiedades y conectar Google también. Ahí el rol lo decide
-- `src/lib/org/rol.ts`, y lo miden los tests de cada ruta.
--
-- TODA CUENTA ES OWNER DE ALGUNA ORGANIZACIÓN, Y ESO NO LO CIERRA ESTA MIGRACIÓN
--
-- Medido por un crítico el 2026-10-08, de punta a punta con PostgREST real: un
-- usuario `client` de X es además owner de la organización personal que
-- `handle_new_user` (0001) le crea al darse de alta, y de las que cree con
-- `create_client_organization` (0024, ejecutable por `authenticated`). Ahí es
-- writer, approver y personal según las funciones de abajo, que miran el rol
-- organización por organización. Eso es correcto —es SU organización—, salvo
-- donde lo que se gasta no es de esa organización:
--
--   * el token de Google es de la AGENCIA. Mapear en P una property ajena —una
--     sin mapeo vivo, o el alias de prefijo de URL de una mapeada, porque la
--     unicidad de la 0017 compara texto— le servía por
--     `POST /api/reports/generate` los clics de Search Console de otro cliente.
--     Lo cierra `property-actions.ts`: mapear pide además owner o admin de la
--     AGENCIA (`operadorDeLaAgencia`, la misma pregunta que el OAuth). Publicar
--     en P queda sin destino por lo mismo: la ficha de GBP sale del mapeo;
--   * la organización activa por defecto de ese client era P, vacía:
--     `elegirOrganizacion()` pone ahora `client` primero.
--
-- Lo que queda, dicho para que no se lea como cerrado: un owner de P puede
-- inscribir en P a cualquier `user_id` que conozca, con cualquier rol
-- (`members_owner_write`, 0013, sin aceptación del invitado), y un client lee
-- los `user_id` del personal de X en `org_members`; y
-- `create_client_organization` busca slugs libres sobre TODAS las
-- organizaciones, así que el sufijo del slug que devuelve delata si existe una
-- cuenta o una organización con ese nombre. Las dos son de la 0013/0024, de
-- antes de esta puerta, y las dos necesitan su propio frente (una invitación
-- que se acepta; un slug que no se derive de datos ajenos). Y la unicidad del
-- mapeo sigue comparando TEXTO: `https://y.test/` no choca con un
-- `sc-domain:y.test` vivo. Ahora sólo un operador de la agencia puede caer en
-- eso, por error y no por ataque; normalizar la property a lo que Google
-- identifica toca `mapping.ts` y `forma_canonica.sql`, y es su propio frente.
-- Los mapeos que YA están vivos en hosted los escribió, antes de esta puerta,
-- cualquier miembro: conviene leerlos una vez contra la lista de clientes.
--
-- LA REGLA DE LO INTERNO, Y CÓMO SE SUMA `board_*`
--
-- Interna es una tabla que sirve para OPERAR al cliente y no es un producto
-- para él. Se declara en `is_internal_surface()` y en ningún otro lado: el eje de
-- lectura sale de ahí, y la suite también. Hoy:
--
--   activity_logs, agent_runs, integration_probe, integration_properties,
--   integration_tokens, platform_tasks; y todo lo que empiece con `board_`.
--
-- `board_*` es el tablero de la 0029 (PR #108). Esta migración se escribió
-- cuando la 0029 todavía era un PR abierto, y por eso la regla es un PREFIJO y no
-- cuatro nombres: no asumía que las tablas existieran, y no falla si no hay
-- ninguna. La 0029 se mergeó antes que ésta (2026-10-08) y hoy son cuatro
-- —`board_cards`, `board_card_collaborators`, `board_card_dependencies`,
-- `board_card_sources`—, todas con el eje y con la lectura de personal. Lo que
-- vale para la próxima tabla que se sume así:
--
--   * en la réplica y en CI las migraciones corren en orden de nombre, así que
--     una migración anterior a ésta se aplica ANTES y el bucle le pone el eje
--     solo; una POSTERIOR no: tiene que re-aplicar este archivo o ponerse el eje
--     ella misma, y si no lo hace el bloque 208 la encuentra sin eje;
--   * en hosted las aplica una persona. Si la 0029 o la 0030 se aplican DESPUÉS
--     de la 0031, sus tablas quedan sin el eje (o, la 0030, con un eje que su
--     bloque 140 rechaza): se re-aplica este archivo entero, que es idempotente
--     (DROP POLICY IF EXISTS + CREATE, CREATE OR REPLACE, el CHECK se
--     reemplaza). El orden correcto es el del nombre: 0029, 0030, 0031;
--   * la suite se pone ROJA por vacuidad hasta que su fixture tenga una fila de
--     la tabla nueva en X y en Y: un eje que nadie ejecutó es una afirmación. Es
--     a propósito, y es lo que obliga a mirar la clasificación.
--
-- Para declarar otra tabla interna: una línea en `is_internal_surface()` y
-- re-aplicar. Para sacarla: lo mismo; el bucle borra la policy de lectura de
-- toda tabla que deja de ser interna. Y la suite (bloque 208) compara la lista
-- con la decisión D2 escrita como literal, así que cambiarla es cambiar también
-- la decisión, a la vista.
--
-- DECISIONES PARA PABLO (tomadas por la sesión directora el 2026-10-07)
--
--   D1. El cliente vive en SU organización —una por cliente, como hoy con
--       `create_client_organization`— y el personal de la agencia es miembro de
--       esa organización con manager o editor. La puerta se mide en UNA
--       organización con un manager y un client.
--   D2. `client` LEE las superficies de cara al cliente de su organización y no
--       escribe nada. No lee lo interno. Eso es lo que lo distingue de `viewer`,
--       que es personal de la agencia en sólo lectura y SÍ ve lo interno.
--       Tres tablas que D2 no nombra quedan de cara al cliente por la regla
--       («lo interno se declara»): `contacts` —la ficha de contacto del propio
--       cliente, un dato suyo; el derecho de acceso del RGPD apunta para ese
--       lado—, `social_image_assets` —contenido— y `org_members` —el cliente ve
--       quién trabaja en su organización, y la aplicación necesita leer su propia
--       membresía para elegir organización—. Si alguna tiene que ser interna, es
--       una línea en `is_internal_surface()`.
--   D3. Escriben sólo owner, admin, manager y editor. `viewer` y `client` no.
--       Medido en `src/` el 2026-10-08 qué escribe con el cliente de sesión, y
--       qué le cambia esto a un viewer (lo mismo vale para un client):
--         * `POST /api/content`: 403 (antes creaba). La ruta pregunta el rol.
--         * borrar un negocio desde la pantalla (`deleteBusinessFromDb`, cliente
--           de navegador): el DELETE afecta 0 filas SIN error —una restrictiva
--           esconde la fila, no rechaza—; la pantalla relee y el negocio sigue
--           ahí, sin mensaje.
--         * dar de alta un negocio en el onboarding (`/onboarding/new-business`
--           → `createTenantInDb`, cliente de NAVEGADOR, en la organización
--           activa): la base rechaza el INSERT en `businesses` con 42501. La
--           primera versión de este encabezado decía «nada más escribe con la
--           sesión» y se le había escapado (crítico del 2026-10-08): el
--           formulario mostraba el mensaje crudo de la RLS. Ahora dice que el
--           rol no crea negocios (`SIN_ROL_PARA_CREAR_NEGOCIO`).
--         * `POST /api/reports/generate`: 403 ANTES del orquestador (antes
--           generaba). La primera versión de este encabezado decía que la base
--           rechazaba el INSERT en `reports` «después de consultar Places y
--           PageSpeed». Era peor, medido por un crítico con PostgREST real: antes
--           de esa negativa el orquestador escribía con `service_role` en
--           `integration_probe` —interna— y en `pagespeed_cache`, y refrescaba el
--           token de la AGENCIA; con un viewer, además, consultaba Search Console
--           y GA4. La ruta lee ahora el negocio como el usuario y pregunta el rol
--           de escribir en SU organización: cero escrituras, cero salidas. Lo que
--           sigue igual: un negocio de la semilla o el `clientSnapshot` —sin
--           organización, sin escrituras— gasta Places y PageSpeed para
--           cualquier sesión, como antes de esta puerta.
--         * `POST /api/profile/evidence-check` escribe `profile_evidence` con
--           `service_role` mirando sólo la membresía: un viewer o un client
--           puede refrescar el estado de la evidencia. No se cambia acá: no es
--           una de las tres acciones de la puerta, y su ruta tiene su propia
--           lista de mutaciones.
--         * nada más escribe con la sesión: `aeo/audit` ya no tenía INSERT
--           (0025) y `POST /api/organizations` crea una organización PROPIA
--           por una RPC SECURITY DEFINER (ver arriba lo que eso implica).
--   D4. Aprobar (`/api/content/approve`) y ensayar o publicar (`/api/publishing/
--       rehearse` y `publish`) exigen owner, admin o manager. Medido antes: ni
--       las rutas ni la 0015/0016 decidían nada por rol —el encabezado de
--       `publish/route.ts` decía «no hay un rol nuevo» y dejaba la separación
--       para una migración de roles—. Modificar integraciones (mapear y desmapear
--       propiedades, el OAuth de Google) exige owner o admin; antes alcanzaba
--       con ser miembro. El OAuth lo pregunta en la AGENCIA (`agencyGuard.ts`).
--       El mapeo, en la organización destino Y en la agencia: el token que el
--       mapeo apunta es de la agencia, y owner de la organización destino lo es
--       cualquiera (ver «TODA CUENTA ES OWNER» arriba). Sin
--       `VULKAN_AGENCY_ORG_ID`, nadie mapea. Las pantallas (`/app/content`,
--       `/app/publishing`, `/app/integrations`, el tablero) dejan de ofrecer lo
--       que la ruta va a negar, y el 403 se lee como negativa de rol y no como
--       defecto (antes el ensayo lo leía como «defecto del código, no
--       reintentar», a un editor que el día anterior ensayaba).
--
-- MEDIDO ROMPIÉNDOLO (2026-10-08, réplica `growthos-replica-h41`, sobre `main`
-- 7a9ed97 con la 0029 y la 0030 adentro)
--
-- Verde: 160 de 160. Cada fila de abajo es esta migración con UNA cosa rota, la
-- suite entera corrida otra vez, y los bloques que se pusieron rojos. Ninguna
-- sobrevivió. S01 a S15 son de la primera ronda (157 bloques); S16 a S22, de la
-- segunda, que agregó 214 a 216 y los casos `scheduled`/`published` del 211
-- después de que un crítico encontrara cuatro mutaciones que sobrevivían.
--
--   S01 `client` en el CHECK y las funciones, SIN el eje de rol ni el de
--       aprobación (el rol nuevo que ninguna policy distingue de viewer)
--                                       rojo 94, 201, 204, 206, 208, 211, 213
--   S02 la restrictiva de INSERT mira `current_user_org_ids()`: la escritura
--       vuelve a no mirar el rol . . . . . . . . . . . . . . rojo 204, 206, 208
--   S03 la de DELETE con `... OR true`: nombra la función y no acota
--                                                            rojo 204, 206, 208
--   S04 la lectura de lo interno mira la membresía: el client ve lo interno
--                                                            rojo 201, 208, 213
--   S05 `integration_tokens` sale de `is_internal_surface()` . . rojo 208, 213
--   S06 `current_user_writer_org_ids()` con viewer . . . . . . . rojo 206, 209
--   S07 `current_user_staff_org_ids()` con client  . . . . . rojo 201, 209, 213
--   S08 `current_user_writer_org_ids()` sin `state = 'active'` . . . . rojo 209
--   S09 sin el eje de aprobación . . . . . . . . . . . . . . . . . . . rojo 211
--   S10 sin su policy de INSERT (un editor inserta algo ya sellado) . rojo 211
--   S11 el bucle se saltea `board_*` (una lista que envejece) . . rojo 201, 208
--   S12 el eje también sobre `pagespeed_cache`, que ninguna sesión alcanza
--                                                                 rojo 140, 208
--   S13 la lectura de personal en TODAS las tablas: el client no ve lo suyo
--                                                             rojo 94, 200, 208
--   S14 `current_user_approver_org_ids()` con editor . . . . . . rojo 209, 211
--   S15 el CHECK sin `client` . . . . la fixture muere: 23514 en org_members
--   S16 sin la policy de DELETE del eje de aprobación . . . . . . . . rojo 216
--   S17 el DELETE de lo sellado con la función de escritura . . . . . rojo 216
--   S18 el eje de aprobación mira `status <> 'approved'` y no el sello
--                                                                     rojo 211
--   S19 la función de personal sin `SET search_path` . . . . . . . . . rojo 214
--   S20 la función de personal como `role <> 'client'` . . . . . . . . rojo 215
--   S21 la de escritura y la de aprobación como `NOT IN (...)` . rojo 215 (x2)
--   S22 `is_internal_surface()` sin el prefijo `board_` . . . . . . . rojo 208
--       (el tablero pasa a «de cara al cliente»: el client lo lee igual que el
--       manager y el 201 queda verde; lo ve el 208, que compara con D2)
--
--   Re-medidas en la segunda ronda, con la suite de 160: S01 (rojo 94, 201,
--   204, 206, 208, 211, 213), S02 (204, 206, 208), S04 (201, 208, 213), S05
--   (208, 213) y S11 (201, 208).
--
-- Las rutas, que la base no ve, se rompieron aparte con `scripts/mutar.sh`: ver
-- el cuerpo del PR.

\set ON_ERROR_STOP on

BEGIN;

-- El ALTER de abajo toma un lock sobre `org_members`, que es la tabla de la que
-- cuelga TODA la RLS. Si algo lo tiene tomado, mejor fallar a los cinco segundos
-- que dejar a cada sesión de la aplicación esperando detrás.
SET LOCAL lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El rol en la columna
-- ─────────────────────────────────────────────────────────────────────────────
-- Se reemplaza el CHECK de la 0001 entero, con el mismo nombre y los roles
-- viejos en el mismo orden: así el .down lo deja byte por byte como estaba, y la
-- huella lo puede comparar.
ALTER TABLE public.org_members DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE public.org_members ADD CONSTRAINT org_members_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'editor', 'viewer', 'client'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quién, en tres funciones
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER por el motivo de la 0001 y la 0013: la consulta a
-- `org_members` no puede quedar sujeta a la RLS de `org_members`, o recursa. Y
-- `state = 'active'` en las tres, como el resolutor desde la 0013: un manager
-- archivado no escribe.
CREATE OR REPLACE FUNCTION public.current_user_writer_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND state = 'active'
     AND role IN ('owner', 'admin', 'manager', 'editor');
$$;

CREATE OR REPLACE FUNCTION public.current_user_staff_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND state = 'active'
     AND role IN ('owner', 'admin', 'manager', 'editor', 'viewer');
$$;

CREATE OR REPLACE FUNCTION public.current_user_approver_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND state = 'active'
     AND role IN ('owner', 'admin', 'manager');
$$;

-- Explícito, como la 0013 con `current_user_admin_org_ids()`: las policies las
-- evalúan con el rol de quien consulta, así que `authenticated` y `anon` tienen
-- que poder ejecutarlas. A `anon` le devuelven vacío —no hay `auth.uid()`—, que
-- es lo que tiene que pasar.
REVOKE ALL ON FUNCTION public.current_user_writer_org_ids()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_staff_org_ids()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_approver_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_writer_org_ids()   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_staff_org_ids()    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_approver_org_ids() TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo interno, declarado en UN lugar
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE porque lo es: mismo nombre, misma respuesta, hasta que una migración
-- la reemplace. Recibe el nombre sin esquema: todo lo que el bucle mira es de
-- `public`.
CREATE OR REPLACE FUNCTION public.is_internal_surface(p_table text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_table IN ('activity_logs', 'agent_runs', 'integration_probe',
                     'integration_properties', 'integration_tokens', 'platform_tasks')
      -- El tablero de la 0029 (PR #108). Ver el encabezado.
      OR p_table LIKE 'board\_%';
$$;

-- Nadie de la API la necesita: la leen esta migración y la suite, como
-- `postgres`. `FROM PUBLIC` no alcanza —los default privileges de Supabase dan
-- EXECUTE por NOMBRE a los tres roles—, así que se revoca por nombre.
REVOKE ALL ON FUNCTION public.is_internal_surface(text) FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El eje de rol, por catálogo
-- ─────────────────────────────────────────────────────────────────────────────
-- Toda tabla de `public` con `organization_id` y RLS. No una lista: una lista a
-- mano envejece en silencio, y la tabla que se agregue mañana con el molde
-- `*_rw_member` repetiría el defecto que esto cierra. Hoy entran 32: 31 que una
-- sesión alcanza y llevan el eje, y `pagespeed_cache`, que no (ver el
-- encabezado). La suite publica los números.
--
-- `TO public` y no `TO authenticated`: una restrictiva que nombra un rol no frena
-- a los demás. `service_role` la saltea igual, por BYPASSRLS, y es quien escribe
-- del lado del servidor.
--
-- `ingest_events` tiene `organization_id` y no tiene RLS —es de la plataforma,
-- 0018— y queda afuera por eso: su aislamiento es el privilegio.
--
-- Las cuatro policies del eje se borran SIEMPRE y se crean según lo que la tabla
-- es AHORA: re-aplicar este archivo después de que una tabla deje de ser interna,
-- o de que ninguna sesión la alcance, también le saca lo que sobra.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.relname,
               -- Alguna permisiva que una sesión puede usar. Las del eje son
               -- restrictivas, así que no se cuentan a sí mismas.
               EXISTS (SELECT 1 FROM pg_policy p
                        WHERE p.polrelid = c.oid AND p.polpermissive
                          AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid,
                                                  'authenticated'::regrole::oid]) AS alcanza_sesion
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
                             AND NOT a.attisdropped
         WHERE c.relkind IN ('r', 'p')
           AND c.relrowsecurity
         ORDER BY c.relname
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.relname || '_role_insert', r.relname);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.relname || '_role_update', r.relname);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.relname || '_role_delete', r.relname);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.relname || '_role_read', r.relname);

        CONTINUE WHEN NOT r.alcanza_sesion;

        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO public
               WITH CHECK (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            r.relname || '_role_insert', r.relname);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO public
               USING (organization_id IN (SELECT public.current_user_writer_org_ids()))
               WITH CHECK (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            r.relname || '_role_update', r.relname);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO public
               USING (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            r.relname || '_role_delete', r.relname);

        IF public.is_internal_surface(r.relname) THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO public
                   USING (organization_id IN (SELECT public.current_user_staff_org_ids()))',
                r.relname || '_role_read', r.relname);
        END IF;
    END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El eje de aprobación sobre `content_assets`
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila con sello sólo la escribe quien aprueba. Lo que deja pasar, a
-- propósito:
--
--   * un editor que edita el CUERPO de un asset aprobado: el trigger de la 0015
--     corre ANTES y baja la fila a borrador con el sello en NULL, así que lo que
--     esta policy ve es una fila sin sello. Es la ergonomía que la 0015 promete;
--   * cualquier escritura sobre un borrador, con el eje de rol de arriba.
--
-- Lo que no: sellar (UPDATE a `approved`, `scheduled` o `published` con hash),
-- insertar algo ya sellado, tocar una fila sellada sin soltarle el sello —por
-- ejemplo pasarla a `scheduled`—, ni BORRAR una fila sellada. Lo penúltimo es
-- más estricto que «sólo sellar», y es porque una policy de UPDATE no ve OLD en
-- su WITH CHECK: no puede distinguir «la sello yo» de «ya estaba sellada».
--
-- La policy mira el SELLO (`approved_hash`), no el `status`, y es a propósito: la
-- ruta de publicar decide por el sello (`publish/route.ts`, «sin approved_hash no
-- se publica»), y el CHECK de la 0015 acepta `scheduled` y `published` con el
-- sello puesto. Una policy que mirara `status = 'approved'` dejaría a un editor
-- sellar como `scheduled`, y ese sello se publica. El bloque 211 lo mide con los
-- tres estados.
--
-- EL DELETE, que la primera versión no tenía. El eje de rol deja borrar a todo
-- el que escribe —el editor incluido—, y `publications_asset_fkey` es ON DELETE
-- CASCADE (0016): un editor, que no aprueba ni publica, borraba un asset sellado
-- y la cascada se llevaba el registro de lo publicado en Google, en una tabla
-- donde `authenticated` no tiene ni un privilegio. Medido en la réplica el
-- 2026-10-08 (bloque 216). Con la policy de DELETE, la fila sellada la borra sólo
-- quien aprueba; el borrador lo sigue borrando cualquiera que escribe.
--
-- Lo que NO cierra, y queda dicho: quien aprueba SÍ borra un asset publicado, y
-- la cascada sigue llevándose su fila del ledger. Es la FK de la 0016, de antes
-- de esta puerta; cambiarla a RESTRICT cambia qué pasa al borrar un negocio con
-- contenido publicado, y es su propio frente.
--
-- `USING (true)` en el UPDATE: la restricción es sobre la fila NUEVA. El bloque
-- 10 de la suite mira que ninguna policy de escritura tenga `WITH CHECK (true)`,
-- y ésta no lo tiene. Y por eso un UPDATE que SUELTA el sello pasa: es la
-- ergonomía de la 0015 —editar el cuerpo baja la fila a borrador sin sello— y
-- la FK compuesta de la 0016 lo impide igual mientras haya una publicación que
-- cite ese sello.
DROP POLICY IF EXISTS "content_assets_approver_insert" ON public.content_assets;
CREATE POLICY "content_assets_approver_insert" ON public.content_assets
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (approved_hash IS NULL
                OR organization_id IN (SELECT public.current_user_approver_org_ids()));

DROP POLICY IF EXISTS "content_assets_approver_update" ON public.content_assets;
CREATE POLICY "content_assets_approver_update" ON public.content_assets
    AS RESTRICTIVE FOR UPDATE TO public
    USING (true)
    WITH CHECK (approved_hash IS NULL
                OR organization_id IN (SELECT public.current_user_approver_org_ids()));

DROP POLICY IF EXISTS "content_assets_approver_delete" ON public.content_assets;
CREATE POLICY "content_assets_approver_delete" ON public.content_assets
    AS RESTRICTIVE FOR DELETE TO public
    USING (approved_hash IS NULL
           OR organization_id IN (SELECT public.current_user_approver_org_ids()));

INSERT INTO public.schema_migrations (version) VALUES ('0031_client_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
