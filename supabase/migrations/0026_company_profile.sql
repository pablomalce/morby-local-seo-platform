-- 0026_company_profile.sql — la ficha común de empresa nace con la llave compuesta.
--
-- QUÉ AGREGA
--
-- Ocho tablas: `company_profiles` —la ficha— y sus siete hijas (oferta,
-- mercados, segmentos, competidores, ICP, objetivos, evidencia). Y una columna
-- nullable en `competitors`, que es el único cambio sobre algo que ya existía.
--
-- Todas cuelgan por PARES. `company_profiles` de `businesses (organization_id,
-- id)`; las hijas de `company_profiles (organization_id, id)`. Un hijo de la
-- organización B colgado de la ficha de la organización A no es difícil de
-- crear: es irrepresentable, y lo dice PostgreSQL con un 23503.
--
-- LA FILA ES LA VERSIÓN, Y ESA ES LA DECISIÓN QUE ORDENA TODO LO DEMÁS
--
-- No hay una ficha estable más una tabla de versiones. Hay una tabla cuya fila
-- ES una versión del perfil estratégico de una empresa, y siete hijas que
-- cuelgan de esa fila. Es lo que permite que H1.2 (versionada e inmutable) sea
-- un trigger y no otra migración de forma, y que H1.3 (un solo ICP) sea un
-- índice y no una convención.
--
-- QUÉ NO HACE
--
-- * No aplica nada a hosted. La puerta de H1.1 dice «en la base DESPLEGADA», y
--   medido en el encabezado de `supabase/qa/schema_fingerprint.sql`: nada en
--   este repositorio aplica migraciones a `tpqiltnskfeycnybczgz` —ni
--   `ci.yml`, ni `vercel.json`, ni `package.json`—. Alguien las aplica con la
--   service key. CI en verde prueba que el esquema del REPOSITORIO cierra el
--   defecto, no que hosted lo tenga.
-- * No pone el guard de inmutabilidad. Hasta que H1.2 lo instale, `published`
--   es un estado que nadie protege de un UPDATE. El CHECK de abajo sólo impide
--   que esté INCOMPLETO, que es la mitad barata.
-- * No absorbe `competitors`, ni `businesses`, ni toca `org_members`. Los tres
--   motivos están escritos donde corresponde, más abajo.
-- * No trae ningún trigger que rellene el tenant. La `0012` los borró y el
--   bloque 13 de `defects_test.sql` prohíbe que vuelvan: los seis sitios de
--   INSERT mandan la columna, y una ficha cómoda que la rellenara pondría ese
--   bloque en rojo. Comodidad a cambio de la única garantía que el esquema
--   puede dar es un mal cambio.
-- * No crea ningún camino por el que Lead Engine lea esto. H1.3 necesita una
--   API de lectura, una credencial de servicio y resolución de organización
--   dentro de Lead Engine; nada de eso es una tabla. Esta migración garantiza
--   que haya UNA fila que leer. No crea quien la lea.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 77 a 93 de `supabase/qa/defects_test.sql`. Los dos que
-- son la puerta de H1.1:
--
--   * el 79 intenta el INSERT cruzado en LAS DIEZ relaciones del subárbol —las
--     siete hijas, el puntero de `competitors`, la FK de tres columnas del ICP y
--     el puntero de la oferta al servicio— y exige el SQLSTATE 23503 EXACTO en
--     cada una. Si alguna FK se vuelve simple, ese INSERT pasa y el bloque se
--     pone rojo nombrando la relación. Si el rechazo viene de una policy (42501)
--     en vez de la FK, también: un rechazo por el motivo equivocado no es la
--     garantía que dice medir. Una sola relación probada no alcanzaba: nueve de
--     las diez podían volverse simples sin que nada lo dijera;
--   * el 81 recorre `pg_constraint` sobre el subárbol de la ficha —calculado
--     por cierre transitivo, no por una lista escrita a mano— y exige que en
--     TODA FK cuyo padre lleva tenant, `organization_id` esté entre las columnas
--     REFERENCIADAS, con el denominador afirmado: cero sobre cero pasa sin mirar
--     nada. Mide CUÁLES columnas y no cuántas: una FK de dos columnas que no
--     lleve el eje del tenant cumple la aridad y no cumple la puerta.
--
-- Y el 80 es el control POSITIVO de las diez: el INSERT legítimo tiene que ser
-- ACEPTADO. Sin él, una migración que rechazara todo pasaría la puerta.
--
-- Los cuatro bloques que la primera versión de esta migración NO tenía, y que
-- son la diferencia entre medir la forma y medir la garantía:
--
--   * el 88 y el 89 corren como `authenticated` con el JWT de un miembro. Las 16
--     policies de la §5 son `TO authenticated` y el rol con el que corren las
--     otras aserciones —`growthos_app`— no es miembro de ese rol: con ENABLE +
--     FORCE y CERO policies aplicables todo le queda denegado, así que ninguna
--     de las 16 se EJECUTABA. El 88 afirma que un miembro LEE su ficha y sus
--     siete hijas; el 89, que ve CERO filas de la otra organización;
--   * el 90 exige 23505 a la SEGUNDA versión publicada de la misma empresa
--     (decisión 16) y el 91 es su control positivo: `superseded` y `published`
--     sí conviven;
--   * el 92 exige 23503 a una versión publicada por alguien que no es miembro de
--     la organización de la ficha (decisión 15);
--   * el 93 ejecuta el UPDATE que repunta una hija a la ficha de OTRA organización
--     —el camino que la puerta de H1.1 no nombra, porque sólo habla de INSERT— y
--     afirma sobre el CATÁLOGO que la fila no se movió, no sobre el SQLSTATE: un
--     UPDATE de una fila que la policy esconde no falla, afecta cero filas y
--     devuelve éxito. Ver decisión 17 para lo que este bloque NO cierra.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS DECISIONES DE PRODUCTO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. LA FICHA NO ES `businesses`, Y NO PODÍA SERLO.
--    `businesses` tiene la semilla (`value_proposition`, `brand_tone`), así que
--    la pregunta era legítima. Le falta tres cosas que no se arreglan con
--    columnas: (a) VERSIÓN — tiene `trg_businesses_updated_at`, es mutable por
--    diseño y hay una sola fila por empresa, así que construir la ficha ahí
--    sería literalmente el modo de fallo que H1.2 nombra, «el versionado es en
--    realidad una columna updated_at sobre una única fila»; (b) CARDINALIDAD —
--    cinco de las siete hijas son uno-a-muchos, y en columnas eso es `jsonb`,
--    con lo cual la evidencia pierde la FK por objetivo que H1.4 necesita para
--    poder contar; (c) AUTORIDAD DE FORMA — `businesses` es un sustantivo
--    canónico y `ESQUEMA_CANONICO.md` §6.1 enumera sus campos uno por uno;
--    agregarle oferta, ICP y objetivos hace divergir el sustantivo compartido,
--    y §2 dice que la forma la gana Vulkan OS (R6).
--    `businesses` es la IDENTIDAD de la empresa. La ficha es su perfil
--    ESTRATÉGICO versionado. La ficha no reemplaza el sustantivo: lo referencia.
--
-- 2. UN SOLO BORRADOR ABIERTO POR EMPRESA, por índice único parcial.
--    Sin esto, «cambiar la ficha» —que es el verbo de H1.2 y de H1.3— es
--    ambiguo: con dos borradores abiertos, cuál se publica lo decide el orden
--    de una query.
--
-- 3. `published` NO ES UNA PALABRA QUE ALGUIEN ESCRIBIÓ.
--    `company_profiles_published_is_complete` exige fecha y persona. Precedente
--    exacto: `publications_published_is_complete` de la `0016`.
--
-- 4. `published_by` VA CON `ON DELETE RESTRICT`, Y ACÁ SE SEPARA DE LA `0015`.
--    La `0015` eligió `ON DELETE SET NULL` para `approved_by` con el motivo
--    escrito: «que una persona se vaya no puede borrar el asset». Es el
--    precedente y no se sigue, porque está MEDIDO que en presencia de un CHECK
--    que exige la columna las dos cosas no conviven: borrar la fila de
--    `auth.users` dispara el SET NULL, el SET NULL viola el CHECK, y el borrado
--    muere con `23514 | new row for relation "c3" violates check constraint`.
--    O sea que el SET NULL no entrega lo que promete: no deja ir a la persona,
--    deja un error confuso en su lugar. `RESTRICT` bloquea el mismo borrado
--    diciendo POR QUÉ, y además es lo correcto para un registro citable: quién
--    publicó una versión es parte de la versión.
--    Consecuencia honesta, porque es el precio: borrar a una persona que
--    publicó exige primero decidir qué pasa con lo que publicó. Eso es una
--    decisión, no un efecto secundario.
--    Y queda declarado que `content_assets` de la `0015` tiene hoy la
--    combinación medida arriba. No se arregla acá: es otro frente (R10).
--
-- 5. RLS `ENABLE` **Y** `FORCE` EN LAS OCHO, y el motivo no es que la puerta lo
--    diga.
--    Medido en la réplica (`supabase/qa/replica.sh`, `supabase/postgres:17.4.1.075`):
--    de 23 tablas de `public`, 22 tienen `relrowsecurity` Y
--    `relforcerowsecurity`. La única sin FORCE es `ingest_events`, que no tiene
--    RLS en absoluto. FORCE es la NORMA de este repositorio, no una excepción
--    de tres tablas: el bucle de la §6 de la `0003` forzó todo lo que tenía RLS
--    sin exclusiones, y la `0008`, `0014`, `0016`, `0017`, `0018`, `0022` y
--    `0025` lo pusieron cada una explícitamente.
--    Y `ENABLE` sin FORCE no sería una opción silenciosa: pondría en ROJO el
--    bloque 6 de `defects_test.sql`, cuyo denominador es una consulta al
--    catálogo en la que una tabla nueva con RLS entra sola.
--    EL RIESGO DEL `SECURITY DEFINER` ESTÁ MEDIDO Y AUSENTE. En esta imagen el
--    rol `postgres` —dueño de las tablas y de `current_user_org_ids()`— tiene
--    `rolbypassrls = t` (medido). BYPASSRLS gana sobre FORCE: FORCE le quita al
--    dueño la exención que le da SER DUEÑO, y no toca una exención de ROL. Así
--    que un trigger o un `SECURITY DEFINER` cuyo dueño sea `postgres` sigue
--    pudiendo leer y escribir bajo FORCE. Aparte: FORCE regula visibilidad de
--    filas, no si un trigger se dispara — el riesgo real era un trigger que
--    necesita LEER otra tabla y ve cero filas, que es exactamente el motivo por
--    el que el comentario de la `0004` dice de
--    `fill_organization_id_from_business` «Deliberately NOT security definer».
--    EL PRECIO, dicho en voz alta porque es el precio de TODO el repositorio y
--    no de esta migración: como `postgres` tiene BYPASSRLS, FORCE no entrega lo
--    que §2 del canónico le atribuye («ni una sesión psql abierta como owner
--    cruza tenants»). Medido: sí cruza. FORCE igual vale la pena —cierra al
--    dueño que NO tenga BYPASSRLS— pero su beneficio está sobredeclarado en el
--    documento rector. Contradicción declarada, no resuelta acá.
--
-- 6. `authenticated` SÓLO LEE. No hay escritor todavía, y un grant sin llamador
--    es superficie, no capacidad. Cuando exista la pantalla que edita la ficha,
--    la migración que la acompañe otorga lo que necesite — y será UNA migración
--    cuyo diff dice quién puede escribir la ficha. Mismo patrón que la `0022` y
--    la `0025`. El `REVOKE` explícito antes del `GRANT` no es prolijidad: los
--    default privileges de Supabase le dan los siete privilegios a los tres
--    roles en cada tabla NUEVA de `public`, así que sin esto ocho tablas
--    pondrían el bloque 14 en rojo. Ya pasó dos veces con `schema_migrations`.
--
-- 7. `UNIQUE (organization_id, id)` SÓLO DONDE ALGO LA REFERENCIA.
--    En `company_profiles` es la línea literal de la puerta, y no restringe
--    nada porque `id` ya es PK — el mismo argumento que la §1 de la `0004`
--    escribió para `businesses_organization_id_id_key`. En `profile_competitors`
--    y `profile_objectives` hace falta de verdad: son destino de una FK
--    compuesta. `profile_segments` lleva la suya con TRES columnas, por lo que
--    dice la decisión 8. En las otras cuatro NO se pone: una constraint que nada
--    necesita es una constraint que nadie puede sacar después sin preguntarse
--    qué protegía.
--
-- 8. UN SOLO ICP POR VERSIÓN, por índice único y no por convención. Eso es el
--    mecanismo de H1.3. Y `primary_segment_id` apunta a un segmento de LA MISMA
--    versión, para que «un solo ICP» no se degrade en silencio: el índice sigue
--    verde, hay una sola fila, y el segmento que describe es de otra versión.
--    ESTO NO SALIÓ BIEN LA PRIMERA VEZ Y CONVIENE QUE QUEDE ESCRITO. El diseño
--    con el que empezó esta migración usaba la FK
--    `(organization_id, primary_segment_id) -> profile_segments (organization_id, id)`
--    y decía «el segmento tiene que ser de la misma versión». Es falso: ese par
--    pincha el TENANT y nada más. El bloque 87 de `defects_test.sql` lo ACEPTÓ en
--    la primera corrida contra la réplica — un ICP de la versión 2 describiendo
--    un segmento de la versión 1, mismo tenant, sin un solo error. La FK pasó a
--    tres columnas, `(organization_id, profile_id, primary_segment_id)`, y
--    `profile_segments` ganó `UNIQUE (organization_id, profile_id, id)` para que
--    tenga adónde apuntar. Es el patrón de nietos de la §6 de la `0004` —«la más
--    ajustada de dos llaves correctas»— y la lección es la de esa §6: la llave
--    ajustada no es una preferencia de estilo, es la diferencia entre pinchar el
--    tenant y pinchar el padre.
--
-- 8bis. LO QUE ESTA MIGRACIÓN NO PINCHA, DICHO ANTES DE QUE ALGUIEN LO SUPONGA.
--    El puntero de `competitors` a `profile_competitors` va por
--    `(organization_id, profile_competitor_id)`, así que pincha el tenant y NO el
--    negocio: dentro de una misma organización con dos negocios, una fila de
--    scrape del negocio X puede engancharse a un rival curado del negocio Y. Es
--    el mismo hueco de nietos que la §6 de la `0004` cerró para
--    `competitors.location_id`, y acá queda abierto porque cerrarlo pide una de
--    dos cosas: denormalizar `business_id` en `profile_competitors` —una segunda
--    copia de lo que `company_profiles` ya dice, y una segunda cosa que mantener
--    en paso— o darle a `competitors` un `profile_id` que hoy no tiene. Las dos
--    son cambios sobre `competitors`, o sea otro frente (R10). El riesgo real es
--    acotado y hay que decir por qué: en este producto un cliente ES su propia
--    organización (ver `CLAUDE.md`), así que lo normal es un negocio por tenant.
--    Acotado no es cerrado. No hay ninguna aserción que lo cubra, a propósito:
--    una aserción sobre un defecto que esta migración no cierra estaría en rojo.
--
-- 9. OBJETIVOS Y EVIDENCIA SON ESTRICTAMENTE COLUMNARES. El `jsonb` queda
--    confinado a `profile_segments.pains`, que es la hija que H1.4 no mide. Las
--    filas de `profile_objectives` son el denominador N de H1.4 y las de
--    `profile_evidence` deciden M; si cualquiera de las dos fuera texto libre,
--    la puerta con más riesgo autodeclarativo del grupo se volvería inmedible,
--    que es precisamente el modo de fallo que ella nombra.
--
-- 10. `source_host` ES UNA COLUMNA GENERADA, Y LA NORMALIZACIÓN VIVE EN UNA
--     FUNCIÓN COMPARTIDA. La regla de H1.4 «origen distinto al dominio propio»
--     compara el host de la fuente contra el de `businesses.website`. Con la
--     normalización en una función IMMUTABLE, los dos lados usan la MISMA, y no
--     hay dos parsers que se separen — la lección que la `0015` dejó escrita al
--     lado de `content_payload_hash`. Precedente de columna generada:
--     `payload_hash`.
--
-- 11. LA EVIDENCIA CUELGA DEL OBJETIVO, NO DE LA FICHA, y eso es una desviación
--     de la LETRA de la puerta, que dice que las siete hijas referencian la
--     ficha. Seis lo hacen. La séptima no, porque H1.4 exige que cada
--     AFIRMACIÓN tenga fuente, y una evidencia colgada de la ficha no sabe a
--     qué objetivo respalda. La consulta de aridad de la puerta sigue dando
--     cero (el par referenciado tiene dos columnas) y el tenant sigue arriba en
--     todo camino. Declarado, no resuelto en silencio.
--
-- 12. `competitors` APUNTA A LA FICHA, NO AL REVÉS, y no se absorbe.
--     No se absorbe porque (a) §3 del canónico la nombra EXPLÍCITAMENTE como
--     verbo de Growth OS que se queda afuera; (b) es salida de scrape por
--     corrida, mutable, y como hija de una versión publicada choca de frente
--     con el guard de H1.2 — el agente la reescribe y el guard la rechazaría; y
--     (c) rompería tres consumidores que ya existen.
--     Pero ignorarla es exactamente «un segundo padrón»: dos listas de quién es
--     el rival, sin nada que las relacione. Así que la tabla MUTABLE gana un
--     puntero nullable a la INMUTABLE. La lista curada de la ficha es el padrón
--     único, y cada fila de scrape se engancha a la fila estratégica que
--     describe. Aditivo y nullable: no toca ningún `.ts`, igual que la `0004`.
--
-- 13. IDENTIFICADORES EN INGLÉS. La `0025` nombró columnas en castellano
--     (`robots_leido`, `acceso`); de la `0001` a la `0018` están en inglés, y
--     el mapeo de §6.1 del canónico es en inglés. Esta es una capa que Lead
--     Engine y el canónico van a leer. Se elige en voz alta en vez de en
--     silencio.
--
-- 14. `profile_offers` APUNTA A `business_services`, PORQUE SI NO ES UN SEGUNDO
--     PADRÓN DE LA OFERTA. Esto lo corrige la propia decisión 12 leída dos veces.
--     «Qué vende la empresa» YA es un sustantivo compartido: `ESQUEMA_CANONICO.md`
--     §3 enumera los cinco —`Organization` → `Business` → (`Location`, `Service`)—
--     y §6.1 mapea `business_services.*` a `services.*` campo por campo. Una
--     segunda lista de la oferta sin puntero, sin absorción y sin una línea que
--     lo justifique es exactamente lo que la decisión 12 llama «un segundo
--     padrón» para argumentar que `competitors` no puede quedar suelta. El mismo
--     argumento se aplica acá, y la primera versión de esta migración no lo
--     aplicó.
--     LA FORMA ES LA DE LA DECISIÓN 12, y no una absorción: `profile_offers`
--     gana un `service_id` NULLABLE con FK COMPUESTA
--     `(organization_id, service_id) -> business_services (organization_id, id)`.
--     La ficha versiona la DECISIÓN estratégica sobre la oferta —promesa, banda
--     de precio, posición— y apunta al servicio OPERATIVO que ya existe y que
--     tiene slug, keywords y páginas colgando. No se absorbe `business_services`
--     por lo mismo que no se absorbe `competitors`: es un sustantivo canónico
--     (§3), es mutable por corrida de contenido, y como hija de una versión
--     publicada chocaría con el guard de H1.2.
--     NULLABLE porque el orden real lo exige: la estrategia se escribe antes de
--     que exista la página. Una oferta sin servicio todavía es una decisión
--     tomada; una oferta que NO PUEDE señalar el servicio que ya existe es un
--     padrón paralelo.
--     LA ÚNICA QUE HACÍA FALTA: `business_services` no tenía `UNIQUE
--     (organization_id, id)` —tiene `(business_id, id)` desde la `0003`— y una FK
--     compuesta necesita una única sobre exactamente las columnas que
--     referencia. Se agrega abajo, y no restringe nada: `id` ya es PK. Es el
--     mismo argumento de la §1 de la `0004`.
--     LO QUE ESTE PUNTERO NO PINCHA, dicho como en la 8bis: va por
--     `(organization_id, service_id)`, así que pincha el TENANT y no el negocio.
--     `profile_offers` no tiene `business_id` y denormalizarlo sería una segunda
--     copia de lo que `company_profiles` ya dice. Dentro de una organización con
--     dos negocios, una oferta de la ficha del negocio X puede señalar un
--     servicio del negocio Y. Mismo hueco de nietos que la 8bis, mismo motivo
--     acotado (un cliente ES su propia organización), y acotado no es cerrado.
--
-- 15. PUBLICAR Y VERIFICAR SON ACTOS DE UN MIEMBRO, Y LO DICE UNA FK COMPUESTA.
--     Medido en la réplica antes de arreglarlo: `published_by` referenciaba
--     `auth.users(id)` a secas, así que una versión de la organización de alice
--     publicada por bob —que no es miembro de esa organización— entraba SIN UN
--     SOLO ERROR. Lo mismo `profile_evidence.verified_by`. Un registro citable
--     que dice «publicada por» una persona ajena al cliente no es auditable: es
--     un nombre puesto al lado de una fila.
--     Las dos FK pasan a `(organization_id, published_by) -> org_members
--     (organization_id, user_id)` y `(organization_id, verified_by) ->
--     org_members (organization_id, user_id)`. Precedente exacto: la `0019` del
--     otro repositorio ató el actor al tenant por el par en vez de al usuario
--     global.
--     Y SE QUITA la FK contra `auth.users`, no se suman las dos: `org_members.
--     user_id` ya referencia `auth.users(id)`, así que la compuesta es un
--     superconjunto estricto —implica que la persona existe Y que es miembro de
--     esa organización— y «dos FK donde una es subconjunto estricto de la otra
--     son dos cosas que mantener en paso sin ganancia» es la §6 de la `0004`.
--     El `ON DELETE RESTRICT` de la decisión 4 sobrevive con el mismo efecto por
--     un camino más largo: `org_members.user_id` cae con `ON DELETE CASCADE`, así
--     que borrar la persona intenta borrar la membresía y ESA es la que queda
--     bloqueada, nombrando la fila. Y la baja de un miembro ARCHIVA desde la
--     `0013`, no borra, así que la fila que sostiene esta FK no se va cuando
--     alguien deja el equipo: quién publicó una versión sigue siendo parte de la
--     versión.
--     MATCH SIMPLE hace el resto: con `published_by` NULL la FK no se comprueba,
--     que es lo que un borrador necesita.
--
-- 16. UNA SOLA VERSIÓN PUBLICADA POR EMPRESA, por índice único parcial simétrico
--     al de la decisión 2.
--     Medido antes de arreglarlo: el único parcial cubría SÓLO `status='draft'`,
--     así que N versiones `published` de la misma empresa entraban. Y como el ICP
--     es único POR VERSIÓN (decisión 8), dos publicadas son DOS ICP publicados —
--     y H1.3 pide que los dos productos lean LA MISMA fila. Con dos, cuál es «el
--     ICP publicado» lo decide el orden de una query, que es exactamente el modo
--     de fallo que la decisión 2 nombra para los borradores.
--     POR QUÉ EL ÍNDICE Y NO UN PUNTERO DE VERSIÓN VIGENTE EN `businesses`. El
--     puntero se consideró y se descarta por dos motivos, en este orden: (a)
--     `businesses` es un sustantivo canónico y §6.1 enumera sus campos uno por
--     uno; agregarle una columna hace divergir el sustantivo compartido, que es
--     el mismo argumento por el que la decisión 1 no construyó la ficha ahí; (b)
--     un puntero necesita ADEMÁS una regla que diga que apunta a una fila
--     `published`, y esa regla es un trigger o un CHECK con subconsulta — el
--     índice parcial da la garantía sin agregar nada que alguien tenga que
--     mantener en paso. La versión vigente se resuelve con
--     `WHERE status='published'`, que con este índice devuelve una fila o
--     ninguna.
--     `superseded` no compite, y eso es el punto: publicar la versión 3 es
--     pasar la 2 a `superseded` y la 3 a `published` en la misma transacción.
--
-- 17. LO QUE ESTA MIGRACIÓN NO CIERRA Y SE MIDIÓ: UNA FICHA SIN HIJAS SE MUDA DE
--     ORGANIZACIÓN. Medido en la réplica, como `postgres`:
--
--         UPDATE company_profiles
--            SET organization_id = <org de bob>, business_id = <negocio de bob>
--          WHERE id = <una ficha de alice sin hijas>;   -- ACEPTADO
--
--     La FK compuesta impide el par INCONSISTENTE —cambiar sólo
--     `organization_id` muere con 23503— y no impide que alguien mande un par
--     consistente de OTRO tenant. Con hijas el UPDATE muere, porque las hijas
--     referencian el par viejo y el `ON UPDATE` es `NO ACTION`.
--     No se cierra acá, y el motivo tiene precedente escrito: la §7 de la `0004`
--     declaró exactamente esto para `businesses` —«A business with no children at
--     all can now change organization»— cuando cambió el trigger anti-reparenting
--     por las FK compuestas. Cerrarlo pide volver a poner un trigger, o sea
--     reabrir esa decisión para TODAS las tablas del eje, y eso es otro frente
--     (R10).
--     LO QUE SÍ QUEDA MEDIDO, y es la mitad que le toca a esta migración: el
--     bloque 93 de `defects_test.sql` ejecuta el UPDATE que repunta una HIJA a la
--     ficha de otra organización y lo mira ser RECHAZADO con el rol de la
--     aplicación. Hoy lo frena el privilegio (decisión 6: `authenticated` sólo
--     LEE) y el bloque guarda el MENSAJE, no sólo el SQLSTATE, para que el día
--     que la migración de escritura otorgue UPDATE se vea si lo que lo frena pasó
--     a ser el `WITH CHECK` de la policy restrictiva o nada.

\set ON_ERROR_STOP on

-- En una transacción, a diferencia de la `0025`. El motivo de la `0025` para no
-- usarla —que una reaplicación no se caiga a la mitad con las tablas creadas y
-- sin políticas— se resuelve igual con los `IF NOT EXISTS` y los
-- `DROP POLICY IF EXISTS` de abajo, y además queda la atomicidad: ocho tablas
-- son demasiadas para que «a la mitad» sea un estado que alguien tenga que
-- diagnosticar.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La normalización del host, que hace falta en dos lugares
-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABLE porque `GENERATED ALWAYS AS` lo exige, y además es cierto: misma
-- URL, mismo host, para siempre.
--
-- Qué saca, medido caso por caso en la réplica: el esquema, el path, el puerto,
-- el `usuario:clave@` y las mayúsculas. `https://user:pw@Ejemplo.com:8443/x` y
-- `http://ejemplo.com` dan los dos `ejemplo.com`.
--
-- Qué NO hace, y es a propósito: no saca el `www.`. `www.ejemplo.com` y
-- `ejemplo.com` son hosts distintos acá. Para la regla de H1.4 eso es la
-- dirección barata del error —una fuente en el propio `www` contaría como
-- origen distinto y el job la dejaría pasar— así que el job de H1.4 tiene que
-- comparar los dos sentidos, y esto queda escrito para que no lo descubra
-- solo.
CREATE OR REPLACE FUNCTION public.url_host(p_url text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(
        split_part(
            regexp_replace(
                split_part(split_part(coalesce(p_url, ''), '://', 2), '/', 1),
                '^[^@/]*@', ''),
            ':', 1)
    );
$$;

COMMENT ON FUNCTION public.url_host(text) IS
    'Host de una URL, normalizado. Vive en una función porque la columna generada de profile_evidence y el job de H1.4 tienen que usar la MISMA: dos parsers se separan.';

REVOKE ALL ON FUNCTION public.url_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.url_host(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1bis. La única que le faltaba a `business_services`
-- ─────────────────────────────────────────────────────────────────────────────
-- Ver decisión 14. `business_services` tiene `UNIQUE (business_id, id)` desde la
-- `0003` —para la FK compuesta de `content_assets`— y ninguna sobre el par del
-- tenant. La FK de `profile_offers.service_id` necesita una única sobre
-- exactamente las columnas que referencia, así que acá está.
--
-- No restringe nada: `id` ya es PK, así que cualquier par que lo contenga es
-- único por construcción. Mismo argumento, con las mismas palabras, que la §1 de
-- la `0004`.
--
-- Va ANTES de §3.1 porque la FK que la usa se crea ahí, y en un DO porque no
-- existe `IF NOT EXISTS` para una constraint: sin la guarda, una reaplicación se
-- cae en esta línea.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.business_services'::regclass
                      AND conname = 'business_services_organization_id_id_key') THEN
        ALTER TABLE public.business_services
            ADD CONSTRAINT business_services_organization_id_id_key
            UNIQUE (organization_id, id);
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La ficha
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_profiles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- El eje, NOT NULL desde el primer día: esta tabla nace sin filas, así que
    -- no hay nada que tolerar mientras tanto. Y NO tiene una FK propia a
    -- `organizations`: el tenant llega con el par contra `businesses`, igual
    -- que en las nueve hijas de la `0004`. Una segunda FK sería un subconjunto
    -- estricto de la primera y dos cosas que mantener en paso.
    organization_id uuid NOT NULL,
    business_id     uuid NOT NULL,

    -- La versión. `int` y no `timestamptz`: «la versión 3» es citable en un
    -- reporte y una marca de tiempo no lo es.
    version         int  NOT NULL,

    status          text NOT NULL DEFAULT 'draft',

    -- El ÚNICO texto libre de la ficha. Todo lo estructurado vive en las
    -- hijas, que es lo que permite contar.
    summary         text,

    published_at    timestamptz,
    -- Decisión 4 (RESTRICT y no SET NULL) y decisión 15: la FK no va contra
    -- `auth.users` sino contra el PAR de `org_members`, más abajo. Sin columna
    -- REFERENCES acá para no tener dos FK donde una es subconjunto de la otra.
    published_by    uuid,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT company_profiles_version_positive CHECK (version >= 1),

    CONSTRAINT company_profiles_status_check
        CHECK (status IN ('draft', 'published', 'superseded')),

    -- Publicada quiere decir: hay fecha y hay persona. Sin esto, 'published' es
    -- una palabra que alguien escribió. Precedente: la `0016`.
    CONSTRAINT company_profiles_published_is_complete
        CHECK (
            CASE WHEN status = 'published'
                 THEN published_at IS NOT NULL AND published_by IS NOT NULL
                 ELSE true
            END
        ),

    -- La línea literal de la puerta de H1.1. No restringe nada —`id` ya es PK—
    -- y existe porque una FK compuesta necesita una única sobre exactamente las
    -- columnas que referencia. Ver decisión 7.
    CONSTRAINT company_profiles_organization_id_id_key UNIQUE (organization_id, id),

    CONSTRAINT company_profiles_business_version_key
        UNIQUE (organization_id, business_id, version),

    CONSTRAINT company_profiles_business_fkey
        FOREIGN KEY (organization_id, business_id)
        REFERENCES public.businesses (organization_id, id) ON DELETE CASCADE,

    -- Decisión 15: quien publica tiene que ser MIEMBRO de la organización de la
    -- ficha, y lo dice el par. Medido antes de esto: con `REFERENCES
    -- auth.users(id)`, bob publicaba una versión de la organización de alice sin
    -- un solo error. MATCH SIMPLE deja pasar el borrador, que tiene la columna en
    -- NULL.
    CONSTRAINT company_profiles_published_by_member_fkey
        FOREIGN KEY (organization_id, published_by)
        REFERENCES public.org_members (organization_id, user_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.company_profiles IS
    'Una fila por VERSIÓN del perfil estratégico de una empresa, no una por empresa. Las siete hijas cuelgan de la fila-versión: ver el encabezado de la 0026.';

COMMENT ON COLUMN public.company_profiles.published_by IS
    'Quién publicó, y tiene que ser MIEMBRO de la organización de la ficha: la FK va contra el par de org_members, no contra auth.users. ON DELETE RESTRICT y no SET NULL. Ver decisiones 4 y 15 de la 0026.';

-- Como máximo un borrador abierto por empresa (decisión 2). Parcial: las
-- versiones publicadas y las superadas no compiten entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_one_draft_key
    ON public.company_profiles (organization_id, business_id)
    WHERE status = 'draft';

-- Y como máximo UNA publicada (decisión 16). Simétrico al de arriba, y hace
-- falta por una razón que el de arriba no cubre: con dos publicadas hay dos ICP
-- publicados —el ICP es único por VERSIÓN— y H1.3 pide que los dos productos
-- lean LA MISMA fila. `superseded` sigue sin competir con nada: publicar la
-- versión 3 es pasar la 2 a `superseded` y la 3 a `published` en una sola
-- transacción.
CREATE UNIQUE INDEX IF NOT EXISTS company_profiles_one_published_key
    ON public.company_profiles (organization_id, business_id)
    WHERE status = 'published';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Las siete hijas
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada una: `organization_id` NOT NULL, `profile_id` NOT NULL, y la FK
-- compuesta contra el par. Ningún índice sobre `profile_id` pelado — «no existe
-- camino de búsqueda que no lleve el tenant encima» (§2 del canónico).
--
-- Escritas una por una y no en un bucle, al revés que la §3 de la `0004`: ahí
-- los pasos eran idénticos para nueve tablas y una copia que se separa de sus
-- ocho hermanas era el modo de fallo a evitar. Acá las columnas son distintas
-- en cada una y lo único idéntico es el par, así que un bucle escondería las
-- diferencias en vez de las repeticiones.

-- 3.1 Oferta — la DECISIÓN estratégica sobre qué vende la empresa, con un puntero
-- al servicio operativo que ya existe. Ver decisión 14: sin ese puntero esta
-- tabla es un segundo padrón de la oferta, que es la acusación que la decisión 12
-- usa para no dejar `competitors` suelta.
CREATE TABLE IF NOT EXISTS public.profile_offers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    profile_id      uuid NOT NULL,

    -- El servicio de `business_services` que esta línea de oferta describe.
    -- NULLABLE porque el orden real lo exige: la estrategia se escribe antes de
    -- que exista la página. Ver decisión 14.
    service_id      uuid,

    name            text NOT NULL,
    description     text,
    price_band      text,
    promise         text,
    position        int  NOT NULL DEFAULT 0,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profile_offers_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE,

    -- Compuesta, igual que el puntero de `competitors` de la §4: una oferta de la
    -- organización A no puede señalar un servicio de la B. `ON DELETE SET NULL`
    -- con LISTA DE COLUMNAS —PostgreSQL 15+, el mismo recurso y el mismo riesgo
    -- de versión que la §4— porque sin la lista PostgreSQL anula las DOS columnas
    -- del par y `organization_id` es NOT NULL: el borrado moriría con 23502.
    -- Y SET NULL y no RESTRICT, al revés que el ICP: que alguien borre un
    -- servicio del catálogo no puede bloquear el borrado por una decisión
    -- estratégica vieja, y la oferta sin servicio sigue siendo una decisión
    -- tomada. Es lo que la nullabilidad ya dice.
    CONSTRAINT profile_offers_service_fkey
        FOREIGN KEY (organization_id, service_id)
        REFERENCES public.business_services (organization_id, id)
        ON DELETE SET NULL (service_id)
);

COMMENT ON TABLE public.profile_offers IS
    'Una fila por línea de oferta de una versión de la ficha: la DECISIÓN estratégica (promesa, banda de precio, posición) sobre un servicio de business_services, que es el sustantivo canónico de la oferta (ESQUEMA_CANONICO §3 y §6.1). Ver decisión 14 de la 0026.';

COMMENT ON COLUMN public.profile_offers.service_id IS
    'El servicio operativo que esta decisión estratégica describe. Nullable: la estrategia se escribe antes de que exista la página. Sin este puntero la tabla sería un segundo padrón de la oferta.';

CREATE INDEX IF NOT EXISTS profile_offers_org_profile_idx
    ON public.profile_offers (organization_id, profile_id);

CREATE INDEX IF NOT EXISTS profile_offers_org_service_idx
    ON public.profile_offers (organization_id, service_id);

-- 3.2 Mercados — dónde opera o vende.
CREATE TABLE IF NOT EXISTS public.profile_markets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    profile_id      uuid NOT NULL,

    -- `char(2)` NOT NULL, calcando la decisión de §6.1 del canónico para
    -- `locations.country`. Se calca la DECISIÓN, no el nombre de la tabla.
    -- Con CHECK de forma porque es un valor que después se compara: `se` y `SE`
    -- serían dos mercados.
    country         char(2) NOT NULL,
    region          text,
    locale          text,
    priority        int NOT NULL DEFAULT 0,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profile_markets_country_shape CHECK (country ~ '^[A-Z]{2}$'),

    CONSTRAINT profile_markets_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.profile_markets IS
    'Dónde opera o vende la empresa, por versión. country char(2) NOT NULL calca la decisión de ESQUEMA_CANONICO §6.1.';

-- Un mercado por país y región. `coalesce(region,'')` y no `(country, region)`
-- pelado: con region NULL, dos filas del mismo país NO competirían —varios NULL
-- no chocan en un único— y «Suecia» entraría dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS profile_markets_org_profile_place_key
    ON public.profile_markets (organization_id, profile_id, country, coalesce(region, ''));

-- 3.3 Segmentos — a quién le vende.
CREATE TABLE IF NOT EXISTS public.profile_segments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    profile_id      uuid NOT NULL,

    name            text NOT NULL,
    industry        text,
    size_band       text,
    buyer_role      text,
    -- El ÚNICO jsonb de las ocho tablas, y acá a propósito: es la hija que H1.4
    -- no mide. Ver decisión 9.
    pains           jsonb NOT NULL DEFAULT '[]'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now(),

    -- Hace falta de verdad: es el destino de `profile_icp.primary_segment_id`, y
    -- lleva `profile_id` EN MEDIO a propósito. Ver decisión 8: con
    -- `(organization_id, id)` la FK del ICP sólo habría pinchado el TENANT, y un
    -- ICP de la versión 2 apuntando a un segmento de la versión 1 entraba —
    -- medido, no razonado: el bloque 87 lo aceptó con esa llave puesta.
    CONSTRAINT profile_segments_profile_id_key UNIQUE (organization_id, profile_id, id),

    CONSTRAINT profile_segments_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.profile_segments IS
    'A quién le vende la empresa, por versión. Único lugar con jsonb en la ficha: es la hija que H1.4 no mide.';

CREATE INDEX IF NOT EXISTS profile_segments_org_profile_idx
    ON public.profile_segments (organization_id, profile_id);

-- 3.4 Competidores — la lista CURADA, que no es el scrape.
CREATE TABLE IF NOT EXISTS public.profile_competitors (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    profile_id      uuid NOT NULL,

    name            text NOT NULL,
    website         text,
    why_they_win    text,
    why_we_win      text,

    created_at      timestamptz NOT NULL DEFAULT now(),

    -- Destino del puntero que gana `competitors` más abajo.
    CONSTRAINT profile_competitors_organization_id_id_key UNIQUE (organization_id, id),

    CONSTRAINT profile_competitors_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.profile_competitors IS
    'La lista CURADA de rivales de una versión: estrategia humana y versionada, no el scrape del agente. La tabla competitors apunta ACÁ. Ver decisión 12 de la 0026.';

CREATE INDEX IF NOT EXISTS profile_competitors_org_profile_idx
    ON public.profile_competitors (organization_id, profile_id);

-- 3.5 El ICP — uno solo por versión, y lo garantiza un índice.
CREATE TABLE IF NOT EXISTS public.profile_icp (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL,
    profile_id         uuid NOT NULL,

    definition         text NOT NULL,
    disqualifiers      text,
    buying_trigger     text,
    budget_band        text,
    primary_segment_id uuid,

    created_at         timestamptz NOT NULL DEFAULT now(),

    -- EL mecanismo de H1.3: PostgreSQL rechaza el segundo ICP de una versión.
    CONSTRAINT profile_icp_one_per_profile_key UNIQUE (organization_id, profile_id),

    CONSTRAINT profile_icp_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE,

    -- El segmento tiene que ser de la MISMA versión, y para eso la FK lleva
    -- TRES columnas y no dos (decisión 8). Con el par
    -- `(organization_id, primary_segment_id)` lo único pinchado era el tenant, y
    -- el bloque 87 lo midió ACEPTANDO un ICP de la versión 2 que describe un
    -- segmento de la versión 1. `profile_id` va en medio porque es la columna
    -- que dice de qué versión es cada una de las dos filas.
    --
    -- ON DELETE RESTRICT y no SET NULL. Medido: `ON DELETE SET NULL` sobre una FK
    -- compuesta falla con `23502`, porque PostgreSQL anula TODAS las columnas y
    -- `organization_id` y `profile_id` son NOT NULL. La forma con lista de
    -- columnas —`SET NULL (primary_segment_id)`, PostgreSQL 15+— sí anda acá
    -- (17.4, comprobado), y no se usa igual: borrar el segmento sobre el que está
    -- construido el ICP es una decisión, no un efecto secundario.
    CONSTRAINT profile_icp_segment_same_profile_fkey
        FOREIGN KEY (organization_id, profile_id, primary_segment_id)
        REFERENCES public.profile_segments (organization_id, profile_id, id)
        ON DELETE RESTRICT
);

COMMENT ON TABLE public.profile_icp IS
    'Una sola fila por versión, por índice único y no por convención: eso es el mecanismo de H1.3.';

-- Sin índice aparte para (organization_id, profile_id): la única de arriba ya es
-- ese índice.

-- 3.6 Objetivos — las AFIRMACIONES, que son el denominador N de H1.4.
CREATE TABLE IF NOT EXISTS public.profile_objectives (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    profile_id      uuid NOT NULL,

    statement       text NOT NULL,
    kind            text NOT NULL,
    metric          text,
    target_value    numeric,
    horizon         date,

    created_at      timestamptz NOT NULL DEFAULT now(),

    -- 'claim' es una afirmación sobre lo que ya es; 'goal', sobre lo que se
    -- quiere. Las dos necesitan fuente, y son dos cubetas distintas del
    -- denominador de H1.4.
    CONSTRAINT profile_objectives_kind_check CHECK (kind IN ('claim', 'goal')),

    -- Destino de `profile_evidence`.
    CONSTRAINT profile_objectives_organization_id_id_key UNIQUE (organization_id, id),

    CONSTRAINT profile_objectives_profile_fkey
        FOREIGN KEY (organization_id, profile_id)
        REFERENCES public.company_profiles (organization_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.profile_objectives IS
    'Las afirmaciones estratégicas de una versión. Estrictamente columnar y sin jsonb: estas filas son el denominador N de H1.4.';

CREATE INDEX IF NOT EXISTS profile_objectives_org_profile_idx
    ON public.profile_objectives (organization_id, profile_id);

-- 3.7 Evidencia — una fila por fuente que respalda UN objetivo.
CREATE TABLE IF NOT EXISTS public.profile_evidence (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    objective_id    uuid NOT NULL,

    kind            text NOT NULL,
    url             text NOT NULL,

    -- El host, calculado por la base. Así la regla de H1.4 «origen distinto al
    -- dominio propio» es una columna que se compara contra
    -- `url_host(businesses.website)`, y no una cadena que el job vuelve a
    -- parsear con su propio criterio. Ver decisión 10.
    source_host     text GENERATED ALWAYS AS (public.url_host(url)) STORED,

    -- La verificación a mano, que el acto humano de H1.4 exige. La FK va contra
    -- el PAR de `org_members` más abajo, no contra `auth.users`: quien verifica
    -- una fuente del cliente tiene que ser miembro de ese cliente. Ver decisión
    -- 15, y está medido que sin eso entraba un verificador ajeno.
    verified_at     timestamptz,
    verified_by     uuid,

    -- Donde el job de H1.4 escribe el resultado del HEAD. Tres columnas y no un
    -- booleano: «nunca se probó», «respondió 200» y «respondió 404» son tres
    -- estados distintos, y el primero no es una medición.
    last_checked_at timestamptz,
    last_status     int,

    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profile_evidence_kind_check CHECK (kind IN ('http', 'manual')),

    -- CHECK de forma sobre el texto que después se compara, como el
    -- `property_ref` de la `0017`. Sin esto, `ejemplo.com` entra y
    -- `source_host` sale vacío, con lo cual la regla de origen distinto
    -- compararía '' contra el dominio propio y pasaría.
    CONSTRAINT profile_evidence_url_shape
        CHECK (url ~ '^https?://[^[:space:]]+$'),

    -- Una fuente 'manual' sin fecha y sin persona no es una verificación
    -- manual: es una fuente que nadie miró declarada como buena.
    CONSTRAINT profile_evidence_manual_is_verified
        CHECK (kind <> 'manual' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)),

    CONSTRAINT profile_evidence_status_range
        CHECK (last_status IS NULL OR last_status BETWEEN 100 AND 599),

    CONSTRAINT profile_evidence_objective_fkey
        FOREIGN KEY (organization_id, objective_id)
        REFERENCES public.profile_objectives (organization_id, id) ON DELETE CASCADE,

    -- Decisión 15, la mitad de la evidencia: quien verifica a mano tiene que ser
    -- miembro de la organización de la ficha. MATCH SIMPLE deja pasar la fuente
    -- 'http' sin verificar, que tiene la columna en NULL.
    CONSTRAINT profile_evidence_verified_by_member_fkey
        FOREIGN KEY (organization_id, verified_by)
        REFERENCES public.org_members (organization_id, user_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.profile_evidence IS
    'Una fila por fuente que respalda UN objetivo. Cuelga del objetivo y no de la ficha: ver decisión 11 de la 0026.';

-- EL LÍMITE DE LA REGLA DE H1.4, ESCRITO ACÁ PORQUE ES ACÁ DONDE ENGAÑA.
--
-- H1.4 pide que la fuente responda «desde un origen distinto al dominio propio».
-- El dominio propio es `url_host(businesses.website)`, y `businesses.website` es
-- NULLABLE y sin CHECK de forma desde la `0001`: con la columna vacía,
-- `url_host('')` devuelve la cadena vacía y la comparación «source_host <> el
-- dominio propio» es CIERTA para cualquier fuente, incluida una del propio sitio.
--
-- O sea que la regla se satisface SOLA en el caso más probable de un cliente
-- nuevo, que es justo cuando nadie cargó todavía el sitio. No es un detalle de
-- implementación del job: es el denominador de la puerta con más riesgo
-- autodeclarativo del grupo, satisfecho por vacío.
--
-- No se cierra en esta migración, y el motivo es de alcance: cerrarlo es poner
-- `NOT NULL` y un CHECK de forma sobre `businesses.website`, o sea un
-- expand/contract sobre un sustantivo canónico con filas vivas — otro frente
-- (R10). Lo que le toca al job de H1.4 es NEGARSE a informar M=0 cuando el
-- dominio propio no se puede resolver, en vez de contar esa fuente como buena.
-- Queda escrito para que no lo descubra solo, igual que el `www.` de la §1.
COMMENT ON COLUMN public.profile_evidence.verified_by IS
    'Quién verificó a mano, y tiene que ser miembro de la organización de la ficha: la FK va contra el par de org_members. Ver decisión 15 de la 0026.';

COMMENT ON COLUMN public.profile_evidence.source_host IS
    'Generada con public.url_host(url). La regla de origen distinto de H1.4 compara columnas, no cadenas reparseadas.';

CREATE INDEX IF NOT EXISTS profile_evidence_org_objective_idx
    ON public.profile_evidence (organization_id, objective_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `competitors` apunta a la ficha
-- ─────────────────────────────────────────────────────────────────────────────
-- Ver decisión 12. Aditivo y nullable: ningún `.ts` cambia.
--
-- `ON DELETE SET NULL (profile_competitor_id)` —la forma con lista de columnas,
-- PostgreSQL 15+—. Medido: sin la lista, PostgreSQL anula las DOS columnas del
-- par y muere con `23502` porque `competitors.organization_id` es NOT NULL. La
-- réplica y hosted son 17.4, así que se puede; es el PRIMER uso de esta sintaxis
-- en este repositorio y si alguien baja la versión de la imagen deja de aplicar.
--
-- Y casi nunca va a dispararse: una fila estratégica de una versión publicada no
-- se va a poder borrar cuando H1.2 instale su guard. Por eso esta dirección del
-- puntero es la que no pelea con la inmutabilidad.

ALTER TABLE public.competitors
    ADD COLUMN IF NOT EXISTS profile_competitor_id uuid;

COMMENT ON COLUMN public.competitors.profile_competitor_id IS
    'La fila estratégica que esta fila de scrape describe. Nullable: el agente encuentra rivales que nadie curó todavía.';

-- En un DO y no en un `ALTER ... ADD CONSTRAINT` pelado: no existe
-- `IF NOT EXISTS` para una constraint, y sin esto una reaplicación se cae acá
-- —después de haber creado las ocho tablas—. Mismo recurso que la `0015`.
--
-- Sin `NOT VALID` + `VALIDATE`, a diferencia de la `0004`: ese par existe para
-- que una fila YA cruzada se reporte nombrando la fila. Acá la columna nace
-- entera en NULL, así que no hay ninguna fila que pueda fallar.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.competitors'::regclass
                      AND conname = 'competitors_profile_competitor_fkey') THEN
        ALTER TABLE public.competitors
            ADD CONSTRAINT competitors_profile_competitor_fkey
            FOREIGN KEY (organization_id, profile_competitor_id)
            REFERENCES public.profile_competitors (organization_id, id)
            ON DELETE SET NULL (profile_competitor_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS competitors_profile_competitor_idx
    ON public.competitors (organization_id, profile_competitor_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS: ENABLE y FORCE en las ocho
-- ─────────────────────────────────────────────────────────────────────────────
-- Ver decisión 5 para el motivo medido y para el precio.
--
-- Acá SÍ un bucle, al revés que en la §3: los tres pasos son idénticos para las
-- ocho tablas, y ocho copias del mismo par de políticas es exactamente el caso
-- donde una se separa de sus siete hermanas sin que nada lo diga. El bloque 78
-- de `defects_test.sql` es lo que prueba que el bucle corrió sobre las ocho.
--
-- `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`, por el motivo escrito
-- en la `0025`: sin eso una reaplicación se cae con las tablas ya creadas.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'company_profiles', 'profile_offers', 'profile_markets',
        'profile_segments', 'profile_competitors', 'profile_icp',
        'profile_objectives', 'profile_evidence'
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

        -- La RESTRICTIVA es la que sigue valiendo el día que alguien agregue
        -- una permisiva de más: las permisivas se suman, las restrictivas se
        -- multiplican. Sale de la `0014` y la repiten la `0016` y la `0025`.
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       t || '_tenant_axis', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I
               AS RESTRICTIVE FOR ALL TO authenticated
               USING (organization_id IN (SELECT public.current_user_org_ids()))
               WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()))',
            t || '_tenant_axis', t);

        -- `FROM PUBLIC` no alcanza: los default privileges de Supabase otorgan
        -- por NOMBRE. Se revoca a los tres y se otorga lo justo (decisión 6).
        EXECUTE format(
            'REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    END LOOP;
END
$$;

INSERT INTO public.schema_migrations (version) VALUES ('0026_company_profile')
ON CONFLICT (version) DO NOTHING;

COMMIT;
