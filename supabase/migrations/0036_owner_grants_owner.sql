-- 0036_owner_grants_owner.sql — el rol de owner lo da y lo quita un owner.
--
-- QUÉ CIERRA
--
-- `members_owner_write` (0013) es `FOR ALL USING (organization_id IN (SELECT
-- current_user_admin_org_ids()))` sin WITH CHECK, así que PostgreSQL usa el
-- USING también para la fila nueva: a quien es admin activo de la organización
-- le alcanza para escribir CUALQUIER membresía de ella, con cualquier rol.
-- Medido el 2026-10-23 en una réplica propia (`growthos-replica-owner36`, `main`
-- 7992d4a), como `authenticated` con el uid de una admin de A:
--
--     UPDATE org_members SET role = 'owner' WHERE user_id = <ella>    UPDATE 2
--     INSERT INTO org_members (...) VALUES (<A>, <otro>, 'owner')      INSERT 0 1
--
-- y A quedó con tres owners activos, dos puestos por una admin. Por el mismo
-- camino la admin degradaba o archivaba al owner que la había sumado.
--
-- La mención medida estaba en el encabezado de `deleteMyAccount`
-- (`src/lib/auth/account-actions.ts`, #117): «un owner suma un admin y el admin
-- se sube a owner». La 0035 (#120) se la llevó a su propio encabezado: su
-- protocolo (b) ORDENA ese UPDATE contra la baja, y su LO QUE NO CIERRA lo deja
-- para otro frente, que es éste. La baja tiene que seguir sabiendo de co-owners
-- —un owner puede sumar otro owner—, pero el camino del admin deja de existir.
--
-- LA REGLA
--
-- Una fila de `org_members` cuyo rol es `owner`, ANTES o DESPUÉS de la
-- escritura, sólo la escribe un owner ACTIVO de esa organización. Para una
-- sesión, eso es:
--
--   * INSERT con rol owner: hay que ser owner activo de la organización de la
--     fila nueva;
--   * UPDATE: si la fila vieja es owner, hay que ser owner activo de su
--     organización (si no, la fila no se ve: 0 filas); si la nueva es owner,
--     owner activo de la organización NUEVA (si no, 42501). Lo segundo cubre
--     subirse a uno mismo y también MUDAR una fila owner de una organización
--     donde se es owner a otra donde sólo se es admin;
--   * DELETE de una fila owner: owner activo. Hoy ninguna sesión tiene DELETE
--     sobre la tabla (0013); la policy está para el día que alguien lo devuelva.
--
-- LA DECISIÓN: EL ADMIN NO ESCRIBE FILAS OWNER, NI PARA ABAJO
--
-- Lo que se pidió decidir es si un admin puede escribir alguna membresía owner.
-- No: ni darla, ni degradarla, ni archivarla, ni desarchivarla, ni cambiarle
-- cualquier otra columna. Archivar o degradar a un owner ES quitarle el rol, y
-- un admin que pudiera hacerlo dejaría la organización sin quien la manda —o se
-- quedaría como el único que administra—. El admin sigue administrando todo lo
-- demás: sumar, ascender hasta admin, degradar y archivar a cualquiera que no
-- sea owner (bloque 253, que además lo mide borrando con DELETE devuelto). Eso
-- es lo que la 0013 le dio y no cambia.
--
-- El owner activo puede todo lo anterior, incluido degradar o archivar a otro
-- owner y a sí mismo (ver LO QUE NO CIERRA).
--
-- POR QUÉ TRES RESTRICTIVAS Y NO UN WITH CHECK NI UN TRIGGER
--
--   * Ponerle WITH CHECK a `members_owner_write` alcanza para la fila nueva y no
--     para la vieja, y la policy es PERMISIVA: se suma con OR. La primera
--     permisiva de escritura que alguien agregue mañana —«un miembro se archiva
--     a sí mismo» para dejar una organización, por ejemplo— le devolvería al
--     admin el camino a owner por el OR, sin tocar esta migración (mutación
--     O11). Una RESTRICTIVA se suma con AND a todas, las de hoy y las que
--     vengan. Es la forma del eje de rol de la 0031, por el mismo motivo.
--   * Un trigger dispara para TODOS, y la regla tiene que dejar afuera a quienes
--     dan owners legítimamente sin ser owners de esa organización: la alta de
--     usuario y la de cliente (ver QUIÉN QUEDA AFUERA). Eximir por nombre de rol,
--     como el firmante de la 0033, es una lista que hay que mantener; eximir por
--     «no hay uid» no sirve, porque `create_client_organization()` corre con el
--     uid del creador, que todavía no es owner de nada nuevo. La RLS ya separa
--     exactamente a esa población: lo que corre con BYPASSRLS queda afuera sin
--     que nadie lo enumere. Y la 0033 necesitaba un trigger porque además
--     REESCRIBE la hora; acá no hay nada que reescribir, sólo qué rechazar.
--   * Lo que se pierde con la RLS: una UPDATE de admin sobre una fila owner no
--     muere, devuelve 0 filas, porque el USING esconde la fila al verbo. Es lo
--     mismo que hace el eje de la 0031 con el client (bloque 204), y el código
--     que el día de mañana administre miembros tiene que mirar cuántas filas
--     cambió. Subirse a owner sí muere con 42501, porque eso lo frena el WITH
--     CHECK, y el mensaje nombra la policy de acá (los bloques lo exigen). Y
--     un upsert o un MERGE de admin que pisa una fila owner —aunque la deje
--     igual— no da 0 filas: muere ENTERO con 42501, con las filas que no eran
--     owner adentro (medido el 2026-10-27 en la revisión de #128). Una pantalla
--     de miembros que guarde la lista entera tiene que mandar las filas owner
--     sólo si quien llama es owner, o escribir de a una.
--
-- `role <> 'owner'` y no `IS DISTINCT FROM`: la columna es NOT NULL desde la 0001.
--
-- LA FUNCIÓN
--
-- `current_user_owner_org_ids()`, hermana de `current_user_admin_org_ids()` y
-- de las tres de la 0031, con `state = 'active'` como todas desde la 0013: un
-- owner archivado no da owners.
--
-- SECURITY DEFINER como sus hermanas, aunque acá no es por la recursión, y está
-- medido (mutación O08): como INVOKER contesta lo mismo HOY, porque las tres
-- restrictivas son de escritura y la lectura de `org_members` pasa sólo por las
-- permisivas de SELECT, que llaman a funciones DEFINER. Es DEFINER para que la
-- respuesta sea un hecho de la tabla y no de lo que quien llama puede leer: una
-- versión INVOKER dejaría de reconocer a un owner el día que una policy de
-- lectura le esconda su propia fila, y recursaría el día que una de SELECT
-- sobre `org_members` la llame. Por conducta no se ve; lo ve el bloque 256.
--
-- EXECUTE sólo a `authenticated`. Las de la 0013 y la 0031 se dan también a
-- `anon` (la 0031 lo hizo aun con `current_user_writer_org_ids()` y
-- `current_user_approver_org_ids()`, que sólo las evalúan policies de
-- escritura). Ésta no: sus tres policies son de escritura sobre `org_members`,
-- y `anon` no tiene INSERT, UPDATE ni DELETE sobre esa tabla. `service_role`
-- tampoco la necesita: tiene BYPASSRLS y nunca evalúa una policy. Si un día
-- `anon` recibiera un grant de escritura, la policy le fallaría con «permission
-- denied for function», que es la dirección barata del error. `growthos_app`, el
-- rol de la suite, la recibe de `supabase/qa/app_role.sql` como todas.
--
-- QUIÉN QUEDA AFUERA, Y POR QUÉ
--
-- Medido sobre la réplica el 2026-10-23: `org_members` tiene FORCE ROW LEVEL
-- SECURITY, así que lo que exime NO es ser dueño de la tabla; es BYPASSRLS, que
-- tienen `postgres` y `service_role` (y ningún otro rol de la API).
--
--   * `handle_new_user()` (0001) y `create_client_organization()` (0024) son
--     SECURITY DEFINER de `postgres`: el INSERT de la membresía owner del
--     creador corre como `postgres` y no evalúa ninguna policy. Ninguna de las
--     dos cambia, y el bloque 255 las ejecuta las dos como `authenticated`, que
--     no tiene BYPASSRLS: como INVOKER, cualquiera de las dos muere en la RLS
--     de `organizations` antes de llegar acá (mutaciones O16 y O19).
--   * `service_role` escribe sin RLS. Desde `src/`, `org_members` se escribe
--     sólo por dos RPC SECURITY DEFINER de `postgres`, que no evalúan ninguna
--     policy: `create_client_organization()` (`POST /api/organizations`, con
--     la sesión de quien crea; el punto de arriba) y la baja de cuenta, que
--     `deleteMyAccount` llama con `service_role`: `delete_account_organizations()`
--     (0035) borra las membresías de quien se va como `postgres`. Los bloques
--     402 a 408 corren con la 0036 puesta, pero solos no dicen que una
--     restrictiva de acá no le llegue a la baja: como INVOKER tampoco le
--     llegaría, porque `service_role` también tiene BYPASSRLS (mutación N3,
--     sólo el 405, por catálogo). Le llega si la baja la corre un rol sin
--     BYPASSRLS, y entonces 402, 403, 404, 406 y 407 se ponen rojos con 40001
--     (N3b).
--   * `ingest_lead_won()` (0019) no escribe `org_members`: la organización que
--     crea nace SIN miembros, y su primer owner lo pone el servidor. El bloque
--     255 la ejecuta y lo mide, para que el día que empiece a dar owners —un
--     owner que no dio un owner— se ponga rojo y alguien lo decida.
--
-- EXPAND, Y NADA MÁS
--
-- Agrega una función y tres policies; no toca ni reemplaza ningún objeto que ya
-- existe, y `members_owner_write` queda como la dejó la 0013. Nada en `src/`
-- escribe `org_members` directamente (grep del 2026-10-27, con la 0035 en
-- `main`: `.select()` en nueve archivos y ninguna escritura; las dos que hay
-- van por las RPC del punto de arriba, que no evalúan policies), así que no hay
-- código desplegado al que le cambie una respuesta. El .down saca las cuatro piezas y vuelve exactamente a la 0013.
--
-- LO QUE NO CIERRA, Y QUEDA DICHO
--
--   * EL ÚLTIMO OWNER. Un owner activo puede degradarse o archivarse —y al otro
--     owner— hasta dejar la organización sin ningún owner activo. Desde ahí
--     nadie por sesión vuelve a dar owner: sólo el servidor. Cerrarlo pide una
--     invariante de conjunto («queda al menos uno») con lock, porque dos owners
--     que se degradan a la vez se leen uno al otro; es su propio frente. La
--     baja de cuenta (0035) cerró la suya —dos co-owners que se van a la vez—
--     bloqueando la organización (bloque 402 y escenario 1 de
--     `baja_concurrente.sh`), pero un owner que se degrada mientras su
--     co-owner se da de baja todavía puede dejarla sin owners: es esta misma
--     invariante. Y tiene otra cara, medida el 2026-10-27 con dos sesiones: si
--     otto archiva a olga mientras una UPDATE de olga sobre su propia fila
--     espera ese lock, cuando otto confirma la de olga se aplica igual —en READ
--     COMMITTED la subconsulta de la policy lee la foto de la sentencia, donde
--     olga todavía es owner activa— y olga queda desarchivada; sin la carrera,
--     la misma UPDATE da 0 filas. Es la misma invariante con lock.
--   * El owner da owner sin aceptación de quien lo recibe, como la 0031 ya dijo
--     de cualquier rol.
--   * Admin sobre admin sigue como estaba: un admin asciende a otro a admin, lo
--     degrada o lo archiva. Lo que se pidió es el rol de owner.
--   * `orgs_update_owner` (0001) deja a un admin editar la fila de
--     `organizations`; no da roles y no es de este frente.
--
-- CÓMO FALLA (bloques 250 a 256 de defects_test.sql)
--
--   250  el ataque medido: la admin de A se sube a owner, suma un owner, se sube
--        por el ON CONFLICT de un upsert, muda a A una fila owner de la
--        organización donde ella sí es owner, y suma o crea owners ARCHIVADOS
--        (la regla mira el rol, no el estado); cada uno muere con 42501
--        nombrando la restrictiva de acá (un upsert que PROPONE owner, como
--        el merge-duplicates de PostgREST, muere en la de INSERT);
--   251  la admin quita el rol: degrada al owner, lo archiva, desarchiva a un
--        owner archivado y, con DELETE devuelto adentro de la medición, borra
--        una fila owner activa y una archivada; cada uno 0 filas;
--   252  la contraprueba: las MISMAS escrituras, hechas por owners activos de A,
--        cambian una fila cada una;
--   253  la admin sigue administrando a quien no es owner: suma, asciende,
--        degrada, archiva y borra;
--   254  `current_user_owner_org_ids()` persona por persona;
--   255  quien da owners sin ser owner de esa organización sigue pudiendo: la
--        alta de usuario y la de cliente (las dos como `authenticated`) y el
--        servidor; e `ingest_lead_won()` no da ninguno;
--   256  por catálogo: la función es DEFINER con `search_path`, sólo la
--        ejecuta `authenticated`, y las tres restrictivas son de PUBLIC.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-23, réplica `growthos-replica-owner36`, sobre
-- `main` 7992d4a). Verde: 201 de 201, y `rollback.sh` deja el esquema idéntico.
-- Cada fila de abajo es esta migración con UNA cosa rota, aplicada después de
-- limpiar la anterior —y de re-aplicar la 0019 y `app_role.sql`—, la suite
-- entera corrida otra vez, y los bloques que se pusieron rojos.
--
--   O01 sin la 0036 (`main`)  . . . . . . . . . . . . rojo 250, 251, 254, 256
--   O02 sin la restrictiva de INSERT  . . . . . . . . . . . . . rojo 250, 256
--   O03 la de UPDATE sin WITH CHECK . . . . . . . . . . . . . . . . sobrevive
--       y es EQUIVALENTE: sin WITH CHECK, PostgreSQL usa el USING de una
--       policy de UPDATE para las dos filas. Por eso la O03b;
--   O03b la de UPDATE con WITH CHECK (true) . . . . . . . . . . rojo 10, 250
--   O04 la de UPDATE sin USING  . . . . . . . . . . . . . . . . . . rojo 251
--   O05 sin la restrictiva de DELETE  . . . . . . . . . . . . . rojo 251, 256
--   O06 la función sin `role = 'owner'` . . . . . . . . . rojo 250, 251, 254
--   O07 la función sin `state = 'active'` . . . . . . . . . . . . . rojo 254
--   O08 la función SECURITY INVOKER . . . . . . . . . . . . . . . . rojo 256
--   O09 las restrictivas con `current_user_admin_org_ids()` . . rojo 250, 251
--   O10 las restrictivas piden owner para CUALQUIER fila  . . . rojo 250, 253
--   O11 las tres PERMISIVAS en vez de restrictivas  . . . rojo 250, 251, 256
--   O12 EXECUTE también para `anon` . . . . . . . . . . . . . . . . rojo 256
--   O13 la función sin `search_path`  . . . . . . . . . . . . . rojo 214, 256
--   O14 las restrictivas sólo `TO authenticated`  . . . . . . . . . rojo 256
--   O15 sin EXECUTE para `authenticated`
--                         rojo 204, 205, 206, 210, 250, 251, 252, 253, 254, 256
--   O16 `create_client_organization()` como INVOKER . . . . . . . rojo 70, 255
--   O17 la función con `role IN ('owner', 'admin')` . . . rojo 250, 251, 254
--   O18 `ingest_lead_won()` le da un owner a la organización que crea
--                                                                   rojo 255
--
-- La O16 y la O18 rompen OTRA migración a propósito: son las que dicen que el
-- 255 mide algo y no da verde sobre caminos que no dan owners.
--
-- RE-MEDIDO (2026-10-27, réplica `growthos-replica-o36`, sobre `main` 1d07da1
-- —con la 0035— más esta rama). Verde: 208 de 208, y `rollback.sh` deja el
-- esquema idéntico (1337 objetos). La revisión de #128 encontró dos huecos en
-- la suite y se taparon: ningún caso escribía una fila owner ARCHIVADA (casos
-- nuevos en 250, 251 y 252), y la alta de usuario del 255 insertaba como
-- `postgres`, con BYPASSRLS, así que daba verde también con
-- `handle_new_user()` como INVOKER (ahora inserta `authenticated`). Con la
-- suite así, O01 a O18 dan los mismos rojos de arriba —ninguno toca los 402 a
-- 408— y además:
--
--   O19 `handle_new_user()` como INVOKER  . . . . . . . . . . . . . rojo 255
--   O20 la de INSERT sólo frena filas owner ACTIVAS . . . . . . . . rojo 250
--   O21 el WITH CHECK de la de UPDATE, sólo owner ACTIVA  . . . . . rojo 250
--   O22 la de DELETE sólo frena filas owner ACTIVAS . . . . . . . . rojo 251
--   O23 el USING de la de UPDATE, sólo owner ACTIVA . . . . . . . . rojo 251
--   N1  la de DELETE sin la excepción del owner . . . . . . . . . . rojo 252
--   N3  `delete_account_organizations()` (0035) como INVOKER  . . . rojo 405
--   N3b la baja corrida por un rol sin BYPASSRLS
--                                       rojo 402, 403, 404, 406, 407 (40001)
--
-- La O19 a la O22 sobrevivían a la suite de antes (la O20 a la O22 son la
-- 0036 que copia el `state = 'active'` de las funciones a las filas).

\set ON_ERROR_STOP on

BEGIN;

-- Los CREATE POLICY toman un lock sobre `org_members`, que es la tabla de la que
-- cuelga TODA la RLS. Si algo lo tiene tomado, mejor fallar a los cinco segundos
-- que dejar a cada sesión de la aplicación esperando detrás.
SET LOCAL lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quién es owner activo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_owner_org_ids()
RETURNS setof uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
    FROM public.org_members
   WHERE user_id = auth.uid()
     AND role = 'owner'
     AND state = 'active';
$$;

-- Por nombre además de PUBLIC: los default privileges de Supabase dan EXECUTE
-- por nombre a los tres roles de la API.
REVOKE ALL ON FUNCTION public.current_user_owner_org_ids()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_owner_org_ids() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El eje de owner, restrictivo, por verbo
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "org_members_owner_insert" ON public.org_members;
CREATE POLICY "org_members_owner_insert" ON public.org_members
    AS RESTRICTIVE FOR INSERT
    WITH CHECK (role <> 'owner'
                OR organization_id IN (SELECT public.current_user_owner_org_ids()));

DROP POLICY IF EXISTS "org_members_owner_update" ON public.org_members;
CREATE POLICY "org_members_owner_update" ON public.org_members
    AS RESTRICTIVE FOR UPDATE
    USING (role <> 'owner'
           OR organization_id IN (SELECT public.current_user_owner_org_ids()))
    WITH CHECK (role <> 'owner'
                OR organization_id IN (SELECT public.current_user_owner_org_ids()));

DROP POLICY IF EXISTS "org_members_owner_delete" ON public.org_members;
CREATE POLICY "org_members_owner_delete" ON public.org_members
    AS RESTRICTIVE FOR DELETE
    USING (role <> 'owner'
           OR organization_id IN (SELECT public.current_user_owner_org_ids()));

INSERT INTO public.schema_migrations (version) VALUES ('0036_owner_grants_owner')
ON CONFLICT (version) DO NOTHING;

COMMIT;
