-- 0029_board.sql — el tablero nace con la organización en cada llave.
--
-- QUÉ AGREGA
--
-- Cuatro tablas, todas con el prefijo `board_`: `board_cards` —la tarjeta— y
-- tres que cuelgan de ella: `board_card_collaborators`, `board_card_dependencies`
-- y `board_card_sources`. Nada sobre algo que ya existía: ninguna columna nueva
-- en otra tabla, ninguna función, ningún trigger.
--
-- Los doce campos de una tarjeta de §6.2 del director, y dónde vive cada uno:
--
--   objetivo        board_cards.objective
--   organización    board_cards.organization_id            (decisión 1)
--   producto        board_cards.product                    (decisión 9)
--   responsable     board_cards.assignee_id                (decisiones 2 y 3)
--   colaboradores   board_card_collaborators               (decisión 6)
--   prioridad       board_cards.priority                   (decisión 9)
--   estimación      board_cards.estimate_minutes           (decisión 9)
--   tiempo real     board_cards.actual_minutes             (decisión 9)
--   dependencias    board_card_dependencies                (decisión 7)
--   fuentes         board_card_sources                     (decisión 8)
--   aprobación      board_cards.approved_by / approved_at  (decisiones 3 y 5)
--   resultado       board_cards.result
--
-- Más `created_by` (quién la creó, decisión 3) y `status` (decisión 10), que son
-- los únicos dos que §6.2 no nombra.
--
-- LA PUERTA ES H3.1, Y LO QUE LA HACE PUERTA ES EL PAR
--
-- Toda columna que nombra a una persona —responsable, creador, aprobador y el
-- colaborador de la tabla puente— es un PAR `(organization_id, <columna>)` con FK
-- contra `org_members (organization_id, user_id)`, la única de la `0001`. Una
-- tarjeta de la organización A cuyo responsable no es miembro de A no es difícil
-- de crear: es irrepresentable, y lo dice PostgreSQL con un 23503 que nombra la
-- FK. Y ninguna persona se guarda sin ese par: el sub de Keycloak ES un uuid,
-- igual que el de Supabase, así que no se distingue por forma; lo único que lo
-- vuelve imposible es que ningún identificador entre al tablero sin
-- PROCEDENCIA. Toda columna que puede llevar uno —en el tablero y en lo que el
-- tablero referencia— viene del padrón por el par, o de una fila que la base
-- acuñó, por una FK validada que empareja el tenant; y eso lo afirma el
-- CATÁLOGO, no una lista (bloque 128). «Tiene una FK con el tenant» no
-- alcanzaba: una FK compuesta contra una tabla puente propia guardaba el sub con
-- todo en verde. Lo que queda abierto está medido y dicho en el bloque 128 y en
-- la tabla de mutaciones de abajo.
--
-- QUÉ NO HACE
--
-- * No aplica nada a hosted (`tpqiltnskfeycnybczgz`). CI en verde prueba que el
--   esquema del REPOSITORIO cumple la puerta; llevarlo a la base desplegada es un
--   acto aparte, con el ritual de `feedback_aplicar_por_mcp_con_guarda`.
-- * No le da escritura a nadie más que a `service_role`. No hay ruta ni pantalla
--   que escriba una tarjeta, y un grant sin llamador es superficie (decisión 11).
--   Con UNA escritura indirecta que no es un grant y que está medida: borrar un
--   negocio anula `cited_business_id` en las tarjetas que lo citaban (decisión
--   1), y DELETE sobre `businesses` lo tiene cualquier miembro activo por
--   `businesses_rw_member` de la `0001`, un `viewer` incluido. Ver la decisión 11.
-- * No toca `org_members`, ni `businesses`, ni `organizations`, ni `src/`.
-- * No impide ciclos de dependencias de dos o más tarjetas (decisión 7), ni que
--   el responsable sea un miembro ARCHIVADO, ni que una tarjeta cuyas personas
--   son miembros de las dos organizaciones se mude de una a otra con un UPDATE
--   (decisión 12).
--
-- CÓMO FALLA
--
-- Rojo en los bloques 121 a 135 de `supabase/qa/defects_test.sql`. Los que SON
-- la puerta de H3.1, uno por punto:
--
--   (1) el 121 intenta la MISMA tarjeta con una persona que no es miembro de esa
--       organización en las CUATRO columnas de persona y exige `23503` NOMBRANDO
--       la FK compuesta de cada una. Corre como `postgres`, que tiene BYPASSRLS:
--       ninguna policy puede ser lo que rechaza, y el nombre de la constraint en
--       el mensaje dice cuál fue;
--   (2) el 122 corre las MISMAS cuatro sentencias —el mismo texto, concatenado
--       detrás del alta de la membresía— y exige que pasen al COMMIT;
--   (3) el 126 lee, como `authenticated` con el `auth.uid()` de una persona de
--       OTRA organización, cada relación del tablero DESCUBIERTA POR CATÁLOGO
--       —tablas, vistas y vistas materializadas: prefijo `board_` más el cierre
--       transitivo de lo que las referencia por FK, de sus hijas y padres por
--       herencia, y de toda vista que las lea— y exige cero filas de la
--       organización dueña; el 127 es su contraprueba: la dueña lee las suyas en
--       cada relación;
--   (4) el 128 recorre `pg_attribute`, `pg_type`, `pg_attrdef` y
--       `pg_constraint` sobre las relaciones del tablero que persisten filas Y
--       sobre lo que el tablero referencia —hasta el tenant y el padrón— y exige
--       que toda columna uuid tenga procedencia: el par contra
--       `org_members (organization_id, user_id)` o una identidad que la base
--       acuñó, por una FK validada que empareja el tenant; que ninguna columna
--       sea un contenedor capaz de llevar un identificador; y que ninguna con
--       nombre de persona quede fuera del padrón. Imprime cuántas columnas miró,
--       también en verde, y exige que sean más de cero.
--
-- Y los demás: el 123 y el 124 cruzan de organización las relaciones que no son
-- personas (tarjeta, dependencia en sus dos puntas, fuente, negocio) con su
-- control positivo; el 125 la auto-dependencia; el 129 que toda tabla del
-- tablero tenga `organization_id` NOT NULL, ENABLE, FORCE y sus dos policies
-- IGUALES a la forma canónica —por igualdad, no por texto parecido—, que toda
-- vista del tablero tenga `security_invoker` y que ninguna sea materializada; el
-- 130 los privilegios, de tabla y por columna; el 131 la baja de una
-- organización entera con el tablero poblado; el 132 y el 133 la baja de UN
-- miembro (decisión 3); el 134 la aprobación a medias (decisión 5); el 135, por
-- catálogo, la regla de la decisión 4 para la próxima tabla.
--
-- MEDIDO ROMPIÉNDOLO (2026-10-06), una mutación por vez contra las 135
-- aserciones. La primera tanda se midió sobre bases NUEVAS —plantilla con la
-- `0001` a la `0028`, la `0029` mutada, `app_role.sql`—. Después un verificador
-- independiente encontró doce formas de guardar un sub de Keycloak o de leer el
-- tablero ajeno con los 135 en verde, y los bloques 126 a 130 se reescribieron.
-- Esta tabla es la corrida de DESPUÉS, con las viejas repetidas: cada mutación
-- se inyecta como DDL justo detrás del `BEGIN` de `defects_test.sql` —y su
-- fixture detrás de la del tablero—, así que el `ROLLBACK` del archivo es la
-- restauración. Cada rojo se leyó en su evidencia, no sólo en su número: nombra
-- la columna, la policy o la relación mutada.
--
--   LAS DE LA PRIMERA TANDA
--   el responsable, FK simple a auth.users (id)  . . rojo 121, 128, 133
--   el colaborador, FK simple a auth.users (id)  . . rojo 121, 128, 133
--   el colaborador a la tarjeta por FK simple  . . . rojo 123, 128
--   la dependencia (su punta depends_on) simple  . . rojo 123, 128
--   el negocio citado por FK simple  . . . . . . . . rojo 123, 128
--   columna nueva `reviewer_id uuid` sin FK  . . . . rojo 128
--   columna nueva `assignee_sub text`  . . . . . . . rojo 128 (la línea por nombre)
--   columna nueva `collaborator_ids uuid[]`  . . . . rojo 128
--   sin FORCE en las cuatro  . . . . . . . . . . . . rojo 6, 129
--   la permisiva de lectura `USING (true)` . . . . . rojo 129
--   la permisiva `USING (organization_id IS NOT NULL)` rojo 129
--   la restrictiva `USING (true) WITH CHECK (true)`  rojo 129
--   las dos capas abiertas a la vez  . . . . . . . . rojo 126, 129
--   `GRANT SELECT ... TO anon` . . . . . . . . . . . rojo 130
--   `GRANT INSERT ... TO authenticated`  . . . . . . rojo 130
--   el responsable se NIEGA en vez de anularse . . . rojo 133
--   el aprobador se ANULA en vez de negarse  . . . . rojo 132 (23514), 135
--   sin el CHECK de auto-dependencia . . . . . . . . rojo 125
--   sin el CHECK de aprobación completa  . . . . . . rojo 134
--   la tarjeta sin CASCADE desde organizations . . . rojo 131, 135
--   una nieta (`board_card_sources.added_by`) que
--     se niega inmediata  . . . . . . . . . . . . . . rojo 135
--   una hija nueva SIN prefijo (`card_comments`),
--     sin RLS y con `author_id uuid` suelto  . . . . rojo 14, 126 (vacua), 127,
--                                                    128, 129, 130. Antes cortaba
--                                                    la corrida en la anti-
--                                                    vacuidad del 126 y escondía
--                                                    a los demás
--
--   LAS DEL VERIFICADOR, que antes daban los 135 en verde
--   un padrón propio `board_external_people` con su
--     PK libre, y `board_cards.external_assignee_id`
--     contra él  . . . . . . . . . . . . . . . . . . rojo 128
--   el padrón SIN prefijo, `kc_people (organization_id,
--     sub)`, padre de `board_cards.kc_assignee`  . . rojo 128
--   una tabla puente `identity_links (organization_id,
--     keycloak_sub)`, padre de `reviewer_id` . . . . rojo 128
--   `kc_identities (organization_id, id)` con PK
--     compuesta, padre de `reviewer_id` . . . . . . rojo 128
--   `card_people` con su `id` acuñado y el sub en
--     `keycloak_sub`, padre de `reviewer_ref`  . . . rojo 128
--   la misma con nombres neutros (`card_links`,
--     `external_key`, `link_ref`)  . . . . . . . . . rojo 128 (sólo la regla de
--                                                    procedencia: el padre se
--                                                    examina)
--   `board_member_prefs (user_id PRIMARY KEY
--     REFERENCES auth.users)`  . . . . . . . . . . . rojo 128
--   la misma, `user_id uuid PRIMARY KEY` sin FK  . . rojo 128
--   la misma, con `DEFAULT gen_random_uuid()`  . . . rojo 128 (sólo la línea por
--                                                    nombre)
--   `board_watchers (user_id PRIMARY KEY
--     REFERENCES auth.users)`  . . . . . . . . . . . rojo 128
--   una hija 1:1 `board_card_reviews (card_id
--     PRIMARY KEY REFERENCES board_cards (id))`, con
--     una fila de P colgada de una tarjeta de T  . . rojo 128
--   una PK libre con nombres neutros
--     (`board_externals.id`, `board_cards.ext_ref`)  rojo 128 (sólo la regla de
--                                                    procedencia)
--   una tabla del tablero con `organization_id` sin
--     ninguna FK . . . . . . . . . . . . . . . . . . rojo 128, 131
--   `reviewer_id` de un dominio sobre un dominio
--     sobre uuid . . . . . . . . . . . . . . . . . . rojo 128
--   `assignee_sub bytea` . . . . . . . . . . . . . . rojo 128
--   `reviewer public.org_members` (tipo fila)  . . . rojo 128
--   `reviewer public.board_person_ref` (compuesto)   rojo 128
--   `people xml` . . . . . . . . . . . . . . . . . . rojo 128
--   `reviewer_id numeric(39,0)`  . . . . . . . . . . rojo 128
--   `approver text`  . . . . . . . . . . . . . . . . rojo 128 (la línea por nombre)
--   la FK del responsable recreada `NOT VALID` con
--     una fila de sub suelto adentro . . . . . . . . rojo 128
--   `archived_cards () INHERITS (board_cards)`, con
--     RLS y una fila con responsable ajeno . . . . . rojo 128, 131
--   la misma, sin filas . . . . . . . . . . . . . . rojo 126 (vacua), 127, 128
--   `board_cards` hija por herencia de un
--     `cards_base` sin RLS . . . . . . . . . . . . . rojo 126, 128, 129
--   una vista materializada `board_card_people_mv`   rojo 126, 128, 129, 130
--   una vista `board_card_people` de `postgres` sin
--     `security_invoker`, con los grants de la 0029  rojo 126, 129
--   la misma SIN prefijo (`card_overview`): la
--     descubre su dependencia  . . . . . . . . . . . rojo 126, 129
--   la permisiva de `board_cards` `organization_id
--     IS NOT NULL OR organization_id IN (...)` . . . rojo 129
--   la restrictiva, igual  . . . . . . . . . . . . . rojo 129
--   las dos, igual . . . . . . . . . . . . . . . . . rojo 126, 129
--   la permisiva de las cuatro `... OR true` . . . . rojo 129
--   la restrictiva de las cuatro `... OR true` . . . rojo 129
--   las dos `... OR true`  . . . . . . . . . . . . . rojo 126, 129
--   `GRANT SELECT (id, organization_id, objective,
--     assignee_id) ON board_cards TO anon` . . . . . rojo 130
--   `GRANT INSERT (...), UPDATE (...) ON
--     board_cards TO authenticated`  . . . . . . . . rojo 130
--
-- Y la de la nieta, medida a mano además del 135: con esa FK puesta y una fuente
-- con `added_by`, la baja de la organización como `service_role` muere con
-- 23503 en `board_card_sources_added_by_member_fkey`. Es la regla de la
-- decisión 4.
--
-- LAS TRES QUE SOBREVIVEN. Dos no son un agujero sino la decisión 4: la FK del
-- aprobador `DEFERRABLE INITIALLY DEFERRED` y la FK del aprobador `RESTRICT` dan
-- las dos los 135 en verde. Ninguna aserción distingue esas tres formas porque
-- no hay diferencia que distinguir con la tarjeta colgando directo de la
-- organización. La primera versión de este archivo tenía la diferible.
-- La tercera SÍ es un agujero, y el único de la tabla que el catálogo no puede
-- cerrar: una tabla del tablero con su PK ACUÑADA (`DEFAULT gen_random_uuid()`),
-- nombres sin ninguna palabra de persona (`board_externals`, `ext_ref`), y
-- alguien que inserta A MANO el sub de Keycloak como `id`. Un default se pisa
-- con un valor explícito —también el de `board_cards.id`—, y el catálogo ve el
-- diseño, no cada INSERT. Da los 135 en verde, medido; la misma tabla SIN el
-- default da rojo 128, que es lo que prueba que la regla de la identidad acuñada
-- es la que separa las dos. Cerrarlo pide mirar los valores, no la forma: es la
-- regla de `DECISION_IDENTIDAD.md` para quien escriba la migración, y el bloque
-- 128 es su red, no su reemplazo.
--
-- Y el `.down`, aparte, con `supabase/qa/rollback.sh 0029_board`. Con el
-- `.down` entero, la huella vuelve idéntica (1010 objetos). Su NEGATIVA con
-- datos ya no está medida sólo a mano: `rollback.sh` siembra una tarjeta
-- (`supabase/qa/down_con_datos/0029_board.sql`) en una copia de la base migrada
-- y exige que el `.down` se niegue sin permiso, que se niegue con el permiso en
-- PGOPTIONS nombrándolo, y que revierta con el permiso dado con SET. Medido
-- rompiéndolo, una mutación por vez sobre el `.down`:
--
--   sin la negativa por falta de permiso  . . . . . rojo «revirtió una base CON
--                                                    DATOS sin que nadie lo
--                                                    pidiera»
--   sin la comprobación del origen del permiso . . . rojo «aceptó un permiso que
--                                                    viene de PGOPTIONS»
--   negándose SIEMPRE  . . . . . . . . . . . . . . . rojo «se negó con PGOPTIONS,
--                                                    pero no por el origen del
--                                                    permiso»
--   sin su `DELETE` de `schema_migrations` . . . . . rojo «dejó 0029_board en
--                                                    schema_migrations»
--
-- `rollback.sh` no corre en CI: es parte del ritual antes de llevar la migración
-- a hosted, no del verde de un PR. Aplicar esta migración DOS veces deja la
-- misma huella (1107 objetos) y una sola fila en el registro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS DECISIONES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. LA TARJETA CUELGA DE LA ORGANIZACIÓN, NO DE UN NEGOCIO. «Organización» es
--    un campo de §6.2 y es el tenant: `organization_id` NOT NULL con FK a
--    `organizations (id) ON DELETE CASCADE`, como `contacts` o `publications`.
--    El negocio es OPCIONAL: una tarjeta de Lead Engine o de Vulkan OS no tiene
--    por qué citar uno. Cuando lo cita, la FK es el par
--    `(organization_id, cited_business_id) -> businesses (organization_id, id)`,
--    así que no puede citar el de otra organización.
--    SE LLAMA `cited_business_id` Y NO `business_id`, Y NO ES ESTÉTICA. En este
--    repositorio `business_id` quiere decir «el negocio PADRE»: toda tabla que
--    tiene esa columna cuelga de `businesses`, y el bloque 12 exige que sea NOT
--    NULL en todas. Medido el 2026-10-06: con el nombre `business_id` y nullable,
--    el bloque 12 se puso rojo («still nullable: board_cards.business_id»). La
--    tarjeta NO cuelga del negocio, lo cita; llamarla como el padre haría que el
--    próximo que lea el esquema la crea hija de `businesses`.
--    Consecuencia, dicha: una tarjeta SOBRE el cliente X vive EN la organización
--    X —un cliente es su propia organización (`CLAUDE.md`)—, y la agencia la
--    trabaja siendo miembro de X. No hay tarjeta «de la agencia sobre X»: sería
--    una fila de un tenant que habla de otro, que es la frontera que el resto
--    del esquema no cruza.
--    Y `ON DELETE SET NULL (cited_business_id)` —la forma con lista de columnas
--    de la §4 de la `0026`, PostgreSQL 15+— y no CASCADE: borrar un negocio no
--    puede borrar el trabajo hecho sobre él. Sin la lista, PostgreSQL anularía
--    también `organization_id`, que es NOT NULL, y el borrado moriría con 23502.
--
-- 2. TODA PERSONA ES UN PAR CONTRA `org_members`, NUNCA `auth.users`. Cuatro
--    columnas: `assignee_id`, `created_by`, `approved_by` y
--    `board_card_collaborators.user_id`. La FK contra `auth.users (id)` a secas
--    —la que la puerta nombra como modo de fallo— ACEPTA a cualquier persona que
--    exista, de la organización que sea: es la mutación que el bloque 121 ve.
--    Y no se suman las dos: `org_members.user_id` ya referencia `auth.users`, así
--    que el par implica que la persona existe Y es miembro (mismo argumento que la
--    decisión 15 de la `0026`).
--    LA REGLA DE `DECISION_IDENTIDAD.md` —ningún identificador con forma de
--    Keycloak se persiste en Growth OS— se vuelve una propiedad del catálogo y no
--    una promesa: el sub de Keycloak es un uuid, así que NO se puede detectar por
--    forma (la corrección del crítico a la puerta); lo que sí se puede es que no
--    haya dónde ponerlo. El bloque 128 exige, sobre el tablero Y sobre todo lo
--    que el tablero referencia —un padre es un lugar donde una persona vive a un
--    salto de la tarjeta—, que toda columna uuid tenga PROCEDENCIA: o la base la
--    acuñó (PK de una sola columna, fuera de toda FK, con un default que genera
--    un uuid), o llega por una FK validada que empareja el tenant y cuyo destino
--    es `org_members.user_id` o una identidad acuñada del padre. «Atada por una
--    FK con el tenant», que es lo que la primera versión pedía, dejaba pasar una
--    tabla puente propia con el sub adentro: lo midió un verificador, y es la
--    federación por atajo que `DECISION_IDENTIDAD.md` prohíbe. Exige además que
--    ninguna columna sea un contenedor capaz de llevar un identificador —arrays,
--    json, xml, bytea, numeric, tipos fila: un identificador adentro de un
--    contenedor no tiene FK posible—, y como segunda línea, más floja y dicha
--    como tal, que ninguna columna con nombre de identidad o de rol (`sub`,
--    `user`, `*_by`, `assignee`, `approver`, `reviewer`, `email`...) sea texto
--    o un uuid fuera del padrón. LO QUE QUEDA ABIERTO, dicho: una persona
--    escrita a mano en `objective` o en `result` —texto libre—, y un sub
--    insertado a mano como `id` de una tabla con PK acuñada y nombres neutros
--    (la tercera sobreviviente de la tabla de mutaciones).
--
-- 3. LA BAJA DE UN MIEMBRO: EL RESPONSABLE SE ANULA; EL APROBADOR SE NIEGA.
--    ES UNA DECISIÓN DE PRODUCTO, y va a Pablo con su consecuencia.
--    Medido el 2026-10-06 sobre `src/`, qué borra hoy una membresía:
--      * nada en el ciclo normal. Dejar el equipo ARCHIVA (`state='archived'`,
--        `0013`): la fila de `org_members` queda, ninguna FK de esta migración se
--        dispara, y la tarjeta sigue nombrando a la persona;
--      * `deleteMyAccount` (`src/lib/auth/account-actions.ts`), con
--        `service_role`, en tres pasos: (1) borra las organizaciones de las que
--        la persona es owner —la cascada se lleva sus tableros enteros, bloque
--        131—; (2) `.from("org_members").delete().eq("user_id", ...)` sobre las
--        membresías que quedan, que son las de organizaciones AJENAS; (3) borra
--        el usuario de Auth, que cae por cascada en las membresías. Es la ÚNICA
--        llamada a `.delete()` sobre `org_members` en `src/` (grep), y desde el
--        2026-10-01 cada paso devuelve `ok: false` si la base se niega.
--    O sea que la pregunta real es: una persona que ejerce el derecho al olvido
--    y es responsable de una tarjeta en una organización que NO es suya, ¿puede
--    irse?
--    LA ELECCIÓN:
--      * responsable (`assignee_id`) y creador (`created_by`):
--        `ON DELETE SET NULL (<columna>)`. Se ANULAN. La tarjeta queda, sin
--        responsable, que es un estado que el tablero puede mostrar y filtrar.
--        Asignar es un estado CORRIENTE de la tarjeta, no un acto que la tarjeta
--        cite; bloquear el olvido por una asignación pone el derecho de una
--        persona en manos de otra organización.
--      * colaborador: `ON DELETE CASCADE`. La fila de la tabla puente ES la
--        arista persona-tarjeta; borrarla es lo único que significa la baja.
--      * aprobador (`approved_by`): `ON DELETE NO ACTION`, la negativa de
--        `published_by` de la `0026`. Se NIEGA. Aprobar es un acto
--        citable —«humanos que aprueban» es la puerta H3.5—, y además anularlo no
--        es posible: el CHECK de la decisión 5 exige fecha Y persona, y
--        `SET NULL (approved_by)` dejaría una aprobación con fecha y sin nadie
--        (23514, el mismo choque que la decisión 4 de la `0026` midió).
--    LA CONSECUENCIA, para cada lado:
--      * con esta elección, la baja de quien fue responsable o creó tarjetas en
--        una organización ajena PASA (bloque 133) y la organización pierde el
--        dato de quién era: no hay historial de asignaciones, así que «quién la
--        tenía» se va con la persona. La de quien APROBÓ una tarjeta ajena falla
--        en el paso 2 con `ok: false` (bloque 132), y si la persona tenía
--        organizaciones propias, esas YA se borraron en el paso 1 —el mensaje lo
--        dice—. Esa organización tiene que decidir antes qué hace con la
--        aprobación;
--      * la alternativa —bloquear también al responsable— se escribe cambiando
--        `SET NULL (assignee_id)` por `NO ACTION`:
--        la persona no puede borrarse hasta que alguien le reasigne cada tarjeta,
--        y `deleteMyAccount` falla en el paso 2 con las organizaciones propias ya
--        borradas. El bloque 133 se pone rojo con ese cambio, que es lo que lo
--        hace una decisión y no un efecto secundario.
--
-- 4. NINGUNA ES DIFERIBLE, Y ESTÁ MEDIDO QUE NO HACE FALTA. Esto empezó al revés
--    y lo dio vuelta una mutación.
--    La regla de la decisión 18 de la `0026` dice que una FK por el par contra
--    `org_members` tiene que ser `DEFERRABLE INITIALLY DEFERRED` para que la baja
--    de la organización entera pase, y la primera versión de este archivo la
--    siguió para el aprobador. Pero esa regla tiene un motivo, escrito ahí: la
--    cascada no corre en profundidad, y la del NIETO —`company_profiles` cuelga
--    de `businesses`, que cuelga de `organizations`— queda en la cola DETRÁS de
--    la comprobación que encola la cascada de `org_members`. La tarjeta no es
--    nieta: cuelga DIRECTO de `organizations`, así que su cascada está en la cola
--    de la sentencia al mismo nivel que la de `org_members`, y la comprobación
--    que ésta encola corre DESPUÉS, con la tarjeta ya borrada. En cualquiera de
--    los dos órdenes entre esas dos cascadas.
--    MEDIDO el 2026-10-06, sobre una base nueva por cada variante: con la FK del
--    aprobador `DEFERRABLE INITIALLY DEFERRED`, con `NO ACTION` inmediata y con
--    `RESTRICT`, los 134 bloques dan verde —el 131, la baja de la organización
--    con una tarjeta aprobada adentro, también—. Una diferibilidad que ninguna
--    aserción distingue es una propiedad que nadie puede verificar, y además
--    tiene un costo: el rechazo del punto (1) de la puerta llegaría en el COMMIT
--    en vez de en la sentencia. Así que se saca.
--    `NO ACTION` y no `RESTRICT`, sin diferencia observable acá (medida: la
--    misma corrida en verde), por el mismo motivo que la decisión 3 de la `0028`:
--    es la que se puede diferir el día que haga falta sin cambiar la acción.
--    LA REGLA QUE QUEDA, para la próxima: una tabla que cuelgue de
--    `board_cards` —una NIETA de `organizations`— y lleve una persona que se
--    NIEGA sí tiene que ser diferible, por la decisión 18 de la `0026`. El
--    bloque 131 no lo ve si la fixture deja esa persona en NULL —medido, con
--    mutación—, así que la regla la afirma el bloque 135 por catálogo: toda FK
--    de persona que se niega está en una hija directa de `organizations` o es
--    diferible.
--
-- 5. APROBADA QUIERE DECIR: HAY FECHA Y HAY PERSONA. `board_cards_approval_is_complete`
--    exige las dos o ninguna. Precedente: `company_profiles_published_is_complete`.
--
-- 6. COLABORADORES EN UNA TABLA PUENTE, NO EN UN `uuid[]`. Un array no puede
--    llevar una FK: sería la columna de identidad sin FK que la regla de la
--    decisión 2 prohíbe, y el bloque 128 la ve. La PK es la terna
--    `(organization_id, card_id, user_id)`: la misma persona no colabora dos
--    veces en la misma tarjeta, y no hace falta un `id` propio.
--
-- 7. DEPENDENCIAS: UNA ARISTA POR FILA, ATADA AL TENANT EN SUS DOS PUNTAS. Las dos
--    columnas, `card_id` y `depends_on_card_id`, van en un par con
--    `organization_id` contra `board_cards (organization_id, id)`: una tarjeta no
--    puede depender de la de otra organización (bloque 123). CASCADE en las dos:
--    borrar una tarjeta borra las aristas que la nombran, no las tarjetas del
--    otro lado. CHECK contra la auto-dependencia (bloque 125).
--    LO QUE NO SE CIERRA: un ciclo de dos o más tarjetas (A depende de B, B de
--    A). Impedirlo pide un trigger que recorra el grafo en cada INSERT, con su
--    propio problema de concurrencia —dos INSERT simultáneos que cierran el ciclo
--    cada uno sin ver al otro—, y eso es otro frente (R10). Declarado, sin
--    aserción que lo cubra: una aserción sobre un defecto que esta migración no
--    cierra estaría en rojo.
--
-- 8. FUENTES EN SU TABLA, COLUMNARES. Una fila por URL, con CHECK de forma como
--    `profile_evidence.url` de la `0026`. No `jsonb` por las dos razones de la
--    decisión 9 de la `0026` y la 2 de esta: se cuentan, y un contenedor es un
--    lugar donde un identificador viaja sin FK.
--
-- 9. PRODUCTO, PRIORIDAD Y TIEMPOS SON CONJUNTOS CERRADOS O NÚMEROS.
--    `product IN ('lead_engine', 'growth_os', 'vulkan_os')`, los tres de §6.2.
--    `priority IN ('urgent', 'high', 'medium', 'low')` y no un entero: el orden
--    lo da la aplicación, y un 2 no dice si es mucho o poco. La estimación y el
--    tiempo real en MINUTOS ENTEROS (`estimate_minutes > 0`,
--    `actual_minutes >= 0`) y no en `interval`: son lo que alguien va a sumar y
--    comparar, y un `interval` con meses no se compara.
--
-- 10. `status`, EL ÚNICO CAMPO QUE §6.2 NO NOMBRA, Y POR QUÉ ESTÁ. Un tablero sin
--     columnas de estado no es un tablero: «resultado» y «tiempo real» no dicen
--     si la tarjeta está en curso o cerrada. Conjunto cerrado,
--     `('backlog', 'doing', 'blocked', 'done', 'cancelled')`. NO hay un CHECK que
--     exija resultado a una tarjeta `done`: es una regla de producto que nadie
--     pidió todavía, y agregarla después es un CHECK, no una migración de forma.
--
-- 11. RLS `ENABLE` Y `FORCE` EN LAS CUATRO; `authenticated` SÓLO LEE. Las mismas
--     dos policies por tabla que la §5 de la `0026` —una permisiva de lectura y
--     una RESTRICTIVA del eje—, las dos por `current_user_org_ids()`, que filtra
--     las membresías archivadas desde la `0013`. `REVOKE ALL` explícito a los
--     tres roles antes de otorgar —los default privileges de Supabase les dan los
--     siete privilegios a los tres en cada tabla nueva— y después: `SELECT` a
--     `authenticated`, CRUD a `service_role`, NADA a `anon`. No hay escritor de
--     sesión todavía; la migración que traiga la pantalla dirá quién escribe.
--     `growthos_app`, el rol de la suite, recibe lo suyo de `app_role.sql`, como
--     con la ficha.
--     «SÓLO LEE» VALE PARA EL GRANT, NO PARA TODO EFECTO, y está medido el
--     2026-10-06 en la réplica, deshaciendo: un `viewer` de T que intenta
--     `UPDATE board_cards SET cited_business_id = NULL` recibe
--     `42501 permission denied for table board_cards`; el mismo `viewer` borra el
--     negocio citado —`businesses_rw_member` de la `0001` es `FOR ALL` para
--     cualquier miembro activo, sin mirar el rol— y la acción de la FK
--     (`ON DELETE SET NULL (cited_business_id)`, decisión 1), que corre como
--     dueña de la tabla, deja la tarjeta sin negocio citado. No cruza de
--     organización y la tarjeta queda; lo que se pierde es «sobre qué negocio
--     era», sin historial. Cerrarlo es una regla sobre quién borra un negocio
--     —la policy de la `0001`—, no sobre el tablero: otro frente.
--
-- 12. LO QUE ESTA MIGRACIÓN NO CIERRA Y SE MIDIÓ, el 2026-10-06 en la réplica,
--     como `postgres` y deshaciendo: un `viewer` ARCHIVADO entra como
--     responsable y como aprobador; una tarjeta sin hijas ni personas cambia de
--     `organization_id` con un UPDATE; la misma, con un responsable que NO es
--     miembro de la organización destino, muere con 23503 en
--     `board_cards_assignee_member_fkey`; y —medido después, como
--     `service_role`— una tarjeta APROBADA cuyo responsable, creador y aprobador
--     son miembros de las DOS organizaciones se muda entera, y sigue aprobada.
--     Ninguna aserción las cubre, a propósito: una aserción sobre un defecto que
--     esta migración no cierra estaría en rojo.
--     a. UN MIEMBRO ARCHIVADO PUEDE SER RESPONSABLE. La FK mira la fila de
--        `org_members`, no su `state`. Cerrarlo por FK pediría llevar `state` en
--        la llave, y entonces archivar a alguien violaría las FK de todas sus
--        tarjetas. Es una regla de la pantalla que asigne, o un trigger: otro
--        frente.
--     b. UNA TARJETA SIN HIJAS Y SIN PERSONAS SE MUDA DE ORGANIZACIÓN con un
--        UPDATE de `organization_id` hecho por quien tenga UPDATE: es la decisión
--        17 de la `0026`, por el mismo motivo (las FK compuestas impiden el par
--        inconsistente, no un par consistente de otro tenant). Hoy sólo
--        `service_role` tiene UPDATE. Con una HIJA puesta, el UPDATE muere: las
--        hijas referencian el par viejo con `ON UPDATE NO ACTION`. Con una
--        PERSONA puesta muere SÓLO si esa persona no es miembro de la
--        organización nueva —el par no existe allá—. Si lo es, pasa, y ése es
--        el caso corriente, no el raro: la decisión 1 dice que la agencia
--        trabaja en X siendo miembro de X, así que la gente de la agencia es
--        miembro de varias organizaciones. Una tarjeta aprobada en T por alguien
--        de la agencia, mudada a P, queda como aprobada en P sin que ninguna FK
--        lo note. Cerrarlo es un trigger que niegue el cambio de
--        `organization_id` en el tablero, o sacarle UPDATE de esa columna a
--        quien escriba: otro frente, y la pantalla que escriba tarjetas tiene
--        que decidirlo.
--     c. EL ROL DEL MIEMBRO NO SE MIRA: un `viewer` puede ser responsable o
--        aprobador. Quién PUEDE aprobar es una regla de permisos (H3.5), no de
--        integridad.
--
-- 13. IDENTIFICADORES EN INGLÉS, como la decisión 13 de la `0026`: es una capa que
--     Vulkan OS va a leer por contrato.

\set ON_ERROR_STOP on

-- En una transacción, como la `0026`: cuatro tablas con sus policies son
-- demasiadas para que «a la mitad» sea un estado que alguien tenga que
-- diagnosticar. La reaplicación la sostienen los `IF NOT EXISTS` y los
-- `DROP POLICY IF EXISTS`; aplicar el archivo dos veces deja la misma huella.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tarjeta
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_cards (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- El tenant, y el campo «organización» de §6.2. Ver decisión 1.
    organization_id  uuid NOT NULL,

    product          text NOT NULL,
    objective        text NOT NULL,

    -- Opcional: ver decisión 1. Con FK por el par, más abajo.
    cited_business_id uuid,

    status           text NOT NULL DEFAULT 'backlog',
    priority         text NOT NULL DEFAULT 'medium',

    estimate_minutes int,
    actual_minutes   int,

    -- Las tres personas de la tarjeta. Ninguna con REFERENCES acá: la FK de cada
    -- una va contra el PAR de `org_members`, más abajo (decisión 2).
    assignee_id      uuid,
    created_by       uuid,
    approved_by      uuid,
    approved_at      timestamptz,

    result           text,

    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT board_cards_product_check
        CHECK (product IN ('lead_engine', 'growth_os', 'vulkan_os')),

    CONSTRAINT board_cards_objective_not_blank
        CHECK (btrim(objective) <> ''),

    CONSTRAINT board_cards_status_check
        CHECK (status IN ('backlog', 'doing', 'blocked', 'done', 'cancelled')),

    CONSTRAINT board_cards_priority_check
        CHECK (priority IN ('urgent', 'high', 'medium', 'low')),

    CONSTRAINT board_cards_estimate_positive
        CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),

    CONSTRAINT board_cards_actual_not_negative
        CHECK (actual_minutes IS NULL OR actual_minutes >= 0),

    -- Decisión 5: fecha y persona, o ninguna.
    CONSTRAINT board_cards_approval_is_complete
        CHECK ((approved_by IS NULL) = (approved_at IS NULL)),

    -- Destino de las tres hijas. No restringe nada —`id` ya es PK— y existe
    -- porque una FK compuesta necesita una única sobre exactamente las columnas
    -- que referencia. Mismo argumento que la §1 de la `0004`.
    CONSTRAINT board_cards_organization_id_id_key UNIQUE (organization_id, id),

    CONSTRAINT board_cards_organization_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id) ON DELETE CASCADE,

    -- Decisión 1. La lista de columnas en el SET NULL es lo que impide que
    -- PostgreSQL anule también `organization_id`.
    CONSTRAINT board_cards_business_fkey
        FOREIGN KEY (organization_id, cited_business_id)
        REFERENCES public.businesses (organization_id, id)
        ON DELETE SET NULL (cited_business_id),

    -- LA PUERTA DE H3.1, PUNTO (1). El responsable tiene que ser miembro de la
    -- organización de la tarjeta, y lo dice el par. Decisión 3: si la membresía
    -- se borra, la tarjeta queda sin responsable. No diferible (decisión 4): el
    -- rechazo del INSERT llega en la sentencia.
    CONSTRAINT board_cards_assignee_member_fkey
        FOREIGN KEY (organization_id, assignee_id)
        REFERENCES public.org_members (organization_id, user_id)
        ON DELETE SET NULL (assignee_id),

    -- Quién la creó. Nullable —un agente de `service_role` crea sin persona— y se
    -- anula con la membresía, como el responsable (decisión 3).
    CONSTRAINT board_cards_creator_member_fkey
        FOREIGN KEY (organization_id, created_by)
        REFERENCES public.org_members (organization_id, user_id)
        ON DELETE SET NULL (created_by),

    -- Quién aprobó. Se NIEGA a la baja de esa membresía (decisión 3). Inmediata
    -- y no al COMMIT: la tarjeta cuelga directo de `organizations` y la baja de
    -- la organización entera pasa igual —medido, decisión 4—. MATCH SIMPLE deja
    -- pasar la tarjeta sin aprobar, que tiene la columna en NULL.
    CONSTRAINT board_cards_approver_member_fkey
        FOREIGN KEY (organization_id, approved_by)
        REFERENCES public.org_members (organization_id, user_id)
        ON DELETE NO ACTION
);

COMMENT ON TABLE public.board_cards IS
    'Tablero transversal (H3.1): una fila por tarjeta, de UNA organización. Toda persona es un par (organization_id, user_id) contra org_members, nunca un uuid suelto: ver el encabezado de la 0029.';

COMMENT ON COLUMN public.board_cards.assignee_id IS
    'Responsable. Miembro de la organización de la tarjeta, por FK compuesta contra org_members. Si la membresía se borra, queda NULL (decisión 3 de la 0029).';

COMMENT ON COLUMN public.board_cards.approved_by IS
    'Quién aprobó. Miembro de la organización, por FK compuesta; se niega a la baja de esa membresía (decisiones 3 y 4 de la 0029).';

-- Los caminos de búsqueda, todos con el tenant adelante. Los tres de personas
-- son además los que recorre la acción de la FK cuando se borra una membresía.
CREATE INDEX IF NOT EXISTS board_cards_org_assignee_idx
    ON public.board_cards (organization_id, assignee_id);
CREATE INDEX IF NOT EXISTS board_cards_org_creator_idx
    ON public.board_cards (organization_id, created_by);
CREATE INDEX IF NOT EXISTS board_cards_org_approver_idx
    ON public.board_cards (organization_id, approved_by);
CREATE INDEX IF NOT EXISTS board_cards_org_business_idx
    ON public.board_cards (organization_id, cited_business_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Colaboradores
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión 6: una tabla puente y no un `uuid[]`, porque un array no lleva FK.
CREATE TABLE IF NOT EXISTS public.board_card_collaborators (
    organization_id uuid NOT NULL,
    card_id         uuid NOT NULL,
    user_id         uuid NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT board_card_collaborators_pkey
        PRIMARY KEY (organization_id, card_id, user_id),

    CONSTRAINT board_card_collaborators_card_fkey
        FOREIGN KEY (organization_id, card_id)
        REFERENCES public.board_cards (organization_id, id) ON DELETE CASCADE,

    -- La persona, por el par. CASCADE: la fila ES la arista (decisión 3).
    CONSTRAINT board_card_collaborators_member_fkey
        FOREIGN KEY (organization_id, user_id)
        REFERENCES public.org_members (organization_id, user_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.board_card_collaborators IS
    'Colaboradores de una tarjeta del tablero: la arista persona-tarjeta, las dos puntas atadas a la misma organización. Ver decisiones 3 y 6 de la 0029.';

-- La PK ya es el camino por tarjeta; éste es el de la persona, que recorre la
-- cascada cuando se borra una membresía.
CREATE INDEX IF NOT EXISTS board_card_collaborators_org_user_idx
    ON public.board_card_collaborators (organization_id, user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dependencias
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión 7. `card_id` depende de `depends_on_card_id`.
CREATE TABLE IF NOT EXISTS public.board_card_dependencies (
    organization_id    uuid NOT NULL,
    card_id            uuid NOT NULL,
    depends_on_card_id uuid NOT NULL,

    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT board_card_dependencies_pkey
        PRIMARY KEY (organization_id, card_id, depends_on_card_id),

    CONSTRAINT board_card_dependencies_not_self
        CHECK (card_id <> depends_on_card_id),

    CONSTRAINT board_card_dependencies_card_fkey
        FOREIGN KEY (organization_id, card_id)
        REFERENCES public.board_cards (organization_id, id) ON DELETE CASCADE,

    CONSTRAINT board_card_dependencies_depends_on_fkey
        FOREIGN KEY (organization_id, depends_on_card_id)
        REFERENCES public.board_cards (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.board_card_dependencies IS
    'Una arista por fila: card_id depende de depends_on_card_id, las dos tarjetas de la MISMA organización. No impide ciclos de dos o más: ver decisión 7 de la 0029.';

CREATE INDEX IF NOT EXISTS board_card_dependencies_org_depends_on_idx
    ON public.board_card_dependencies (organization_id, depends_on_card_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fuentes
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión 8.
CREATE TABLE IF NOT EXISTS public.board_card_sources (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    card_id         uuid NOT NULL,

    url             text NOT NULL,
    title           text,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT board_card_sources_url_shape
        CHECK (url ~ '^https?://[^[:space:]]+$'),

    CONSTRAINT board_card_sources_card_fkey
        FOREIGN KEY (organization_id, card_id)
        REFERENCES public.board_cards (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.board_card_sources IS
    'Fuentes de una tarjeta del tablero: una fila por URL, columnar. Ver decisión 8 de la 0029.';

CREATE INDEX IF NOT EXISTS board_card_sources_org_card_idx
    ON public.board_card_sources (organization_id, card_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: ENABLE y FORCE en las cuatro, y los privilegios
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión 11. Un bucle, por el motivo de la §5 de la `0026`: los pasos son
-- idénticos para las cuatro, y cuatro copias del mismo par de policies es el
-- caso donde una se separa de sus hermanas sin que nada lo diga. Lo que prueba
-- que el bucle corrió sobre TODAS no es esta lista: es el bloque 129, que
-- descubre las tablas del tablero por catálogo.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'board_cards', 'board_card_collaborators',
        'board_card_dependencies', 'board_card_sources'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       t || '_read_member', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I
               FOR SELECT TO authenticated
               USING (organization_id IN (SELECT public.current_user_org_ids()))',
            t || '_read_member', t);

        -- La RESTRICTIVA es la que sigue valiendo el día que alguien agregue una
        -- permisiva de más: las permisivas se suman, las restrictivas se
        -- multiplican. Sale de la `0014`.
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       t || '_tenant_axis', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I
               AS RESTRICTIVE FOR ALL TO authenticated
               USING (organization_id IN (SELECT public.current_user_org_ids()))
               WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()))',
            t || '_tenant_axis', t);

        -- `FROM PUBLIC` no alcanza: los default privileges de Supabase otorgan
        -- por NOMBRE. Se revoca a los tres y se otorga lo justo.
        EXECUTE format(
            'REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    END LOOP;
END
$$;

INSERT INTO public.schema_migrations (version) VALUES ('0029_board')
ON CONFLICT (version) DO NOTHING;

COMMIT;
