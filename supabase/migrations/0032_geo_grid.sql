-- 0032_geo_grid.sql — la grilla geográfica: una corrida declarada y sus N
-- observaciones, cada una con su coordenada, su hora, su fuente y su resultado.
--
-- LA PUERTA ES H2-GO-3 (la versión CORREGIDA por el crítico, ESPINA_VULKAN_II.md)
--
-- Una corrida guarda, para una palabra clave y una grilla declarada (centro,
-- radio, paso, N puntos), N observaciones con coordenada, hora, fuente y
-- posición o «no aparece»; el informe publica el denominador (N puntos, cuántos
-- devolvieron dato, cuántos fallaron). Y la grilla es geográfica o no mide nada:
-- tres corridas en la misma sesión —A (centro C), A' (centro C, repetida) y B
-- (centro C desplazado una distancia DECLARADA antes de correr)— y verde sólo si
-- d(A,A') < d(A,B)/3 y d(A,B) > 0. Esa cuenta vive en `src/lib/geo/grilla.ts`;
-- esta migración guarda lo que la cuenta lee.
--
-- QUÉ AGREGA
--
-- Tres tablas con el prefijo `geo_grid_`, y nada sobre algo que ya existía:
-- ninguna columna nueva en otra tabla, ninguna función, ningún trigger.
--
--   geo_grid_spend_approvals  una fila por APROBACIÓN DE GASTO: la organización,
--                          cuántas corridas (1 a 3), quién aprobó y hasta
--                          cuándo vale. El acto humano de la puerta, escrito
--                          (decisión 13).
--   geo_grid_runs          una fila por corrida: la grilla DECLARADA (centro,
--                          radio, paso, N), la palabra clave, el lugar que se
--                          busca, el valor fijo de «no aparece», el
--                          desplazamiento declarado, el CUPO de la aprobación
--                          que la paga, quién la corrió y cuándo empezó y
--                          terminó.
--   geo_grid_observations  una fila por punto: la celda (fila, columna), la
--                          coordenada que se le mandó a Google —que tiene que
--                          ser la de esa celda en esa grilla (decisión 14)—, la
--                          hora, la fuente, y UNO de tres resultados.
--
-- LOS TRES RESULTADOS, Y POR QUÉ SON TRES
--
-- `position` (el lugar aparece, en la posición 1 a 20), `absent` (Google contestó
-- y el lugar no está entre los 20) y `failed` (Google NO contestó: un error, un
-- timeout, un 429). «Ausencia, cero y fallo son tres estados distintos» (§13 del
-- director), y la puerta lo nombra como modo de fallo: si los puntos que
-- fallaron se cuentan como «no aparece», el denominador de fallos da cero
-- siempre. El CHECK `geo_grid_observations_outcome_coherent` hace que cada
-- resultado lleve EXACTAMENTE lo suyo: una posición sólo con `position`, un
-- código de error sólo —y siempre— con `failed`. Un fallo sin código no se puede
-- escribir, y un «no aparece» con código tampoco.
--
-- DECISIONES
--
-- 1. LA CORRIDA CUELGA DE LA ORGANIZACIÓN Y DEL NEGOCIO, POR EL PAR. Como
--    `board_cards` (0029, decisión 1): `organization_id` NOT NULL con FK a
--    `organizations (id) ON DELETE CASCADE`, y el negocio por
--    `(organization_id, business_id) -> businesses (organization_id, id)`, la
--    única de la `0004`. Una corrida de A sobre el negocio de B es
--    irrepresentable: 23503 nombrando la FK (bloque 300).
--    CASCADE desde el negocio, y no una negativa: el negocio es el SUJETO de la
--    medición, y sin él la corrida no dice nada de nadie. Es lo mismo que hacen
--    todas las hijas de `businesses` desde la `0001`. Lo que eso deja abierto,
--    dicho: un miembro que puede borrar el negocio —hoy cualquiera activo, por
--    `businesses_rw_member` de la `0001`— borra con él su historia de grillas.
--    Cerrarlo es una regla sobre quién borra un negocio: el mismo «otro frente»
--    que la decisión 11 de la `0029`.
--
-- 2. QUIÉN LA CORRIÓ ES UN PAR CONTRA `org_members`, NUNCA `auth.users`. Como las
--    cuatro personas del tablero (0029, decisión 2): `(organization_id,
--    created_by) -> org_members (organization_id, user_id)`. Una persona que no
--    es miembro de la organización de la corrida no puede figurar como quien la
--    corrió (bloque 300). `ON DELETE SET NULL (created_by)`: la baja de la
--    persona —el derecho al olvido de `deleteMyAccount`— anula el nombre y deja
--    la medición, que no es de esa persona sino de la organización (bloque 308).
--    Nullable por eso mismo.
--
-- 3. LA OBSERVACIÓN CUELGA DE LA CORRIDA POR EL PAR. `(organization_id, run_id)
--    -> geo_grid_runs (organization_id, id)`: la observación de A no puede
--    colgar de una corrida de B. Y la celda es única por corrida:
--    `UNIQUE (organization_id, run_id, grid_row, grid_col)`. Sin FK directa a
--    `organizations`, como las hijas del tablero: la de la corrida ya la ata a
--    una organización que existe, y la cascada llega por ahí.
--
-- 4. EL TOPE DE PUNTOS TAMBIÉN ESTÁ EN LA BASE. Acto humano de H2-GO-3, DECIDIDO
--    por la sesión directora (recomendación 11a): máximo 9 puntos por corrida
--    (3x3). El servidor lo hace cumplir antes de salir a la red
--    (`TOPE_DE_PUNTOS` en `src/lib/geo/grilla.ts`) y la base lo repite, por dos
--    lados: `n_points IN (1, 4, 9)` —grillas cuadradas de lado 1, 2 o 3— y la
--    celda de cada observación DENTRO DEL LADO DE SU CORRIDA, con la celda
--    única: una corrida no puede TENER más observaciones que puntos declarados
--    aunque alguien escriba sin pasar por la ruta. Hasta el 2026-10-09 la celda
--    se acotaba a 0..2 sin mirar la corrida, y una de UN punto aceptaba nueve
--    observaciones (medido en la réplica: `INSERT 0 9`). Subir el tope es una
--    decisión de gasto, y pasa por una migración a propósito.
--
-- 5. «NO APARECE» SE MAPEA A UN VALOR FIJO DECLARADO EN LA CORRIDA.
--    `unmatched_value`, 21 por defecto, entre 21 y 100: FUERA del rango de las
--    posiciones, para que un «no aparece» nunca se confunda con un puesto. La
--    distancia entre dos corridas sólo se calcula si las dos declaran el mismo
--    valor (`grilla.ts`).
--
-- 6. EL DESPLAZAMIENTO SE DECLARA EN LA FILA, ANTES DE LA PRIMERA OBSERVACIÓN.
--    `declared_shift_m`: la distancia que la prueba de A/A'/B promete entre los
--    centros, escrita al crear la corrida —antes de salir a la red, así que
--    `started_at` la precede a toda observación—. Nullable: una corrida suelta
--    no es parte de una prueba. El veredicto exige que las tres la declaren
--    igual y que la distancia MEDIDA entre los centros de A y B coincida.
--
-- 7. LA FUENTE ES UNA SOLA, Y ESTÁ ESCRITA. `source` es un conjunto cerrado de
--    un elemento, `google_places_text_search`. La puerta pide «fuente» por
--    observación; el modo de fallo que nombra es el cliente mock, y ése ya no
--    existe (H2-GO-0, #98). Una fuente nueva es un CHECK nuevo, no un texto
--    libre.
--
-- 8. EL CÓDIGO DE ERROR ES UN CONJUNTO CERRADO. `http_<status>` o uno de
--    `timeout`, `network`, `invalid_response`, `missing_key`, los mismos que
--    produce `posicionEnPunto` en `src/lib/integrations/google/places.ts`. Sin
--    el texto del proveedor: un mensaje de Google puede traer la clave
--    enmascarada o el proyecto, y no hace falta para distinguir un 429 de un 403.
--
-- 9. RLS `ENABLE` Y `FORCE` EN LAS TRES; `authenticated` SÓLO LEE. Las dos
--    policies por tabla de la `0029` (decisión 11): una permisiva de lectura y
--    una RESTRICTIVA del eje, las dos por `current_user_org_ids()`, que filtra
--    las membresías archivadas desde la `0013`. `REVOKE ALL` explícito a los
--    tres roles —los default privileges de Supabase les dan todo en cada tabla
--    nueva— y después `SELECT` a `authenticated`, CRUD a `service_role`, NADA a
--    `anon`. Escribe el servidor (`POST /api/geo/grid`), que verifica la
--    organización EN CÓDIGO antes, porque `service_role` saltea la RLS (§12.3
--    del director). La aprobación de gasto no la escribe ni la ruta: una
--    persona con `service_role`, a mano (decisión 13).
--
-- 10. IDENTIFICADORES EN INGLÉS, como la decisión 13 de la `0026`.
--
-- 11. EL EJE DE ROL DE LA `0031`, SI ESTÁ. La `0031_client_role` (H4.1, PR #114)
--     era un PR abierto cuando esto se escribió —hoy está en `main`, y esta
--     migración corre después—, y su encabezado dice qué le
--     toca a una migración POSTERIOR: las migraciones corren en orden de nombre,
--     su bucle le pone el eje de rol a toda tabla con `organization_id` que YA
--     existe, y una tabla creada después tiene que ponérselo ella misma. Eso
--     hace la sección 4 de abajo, SÓLO si `current_user_writer_org_ids()`
--     existe: sobre `main` sin la `0031` no hace nada, y en cualquiera de los
--     dos órdenes de aplicación el resultado es el mismo —0031 y después 0032:
--     lo pone la sección 4; 0032 y después la 0031: lo pone el bucle de la
--     0031—.
--     LA CLASIFICACIÓN, DICHA: las tres tablas son DE CARA AL CLIENTE (D2 de la
--     `0031`), no internas. El mapa de posiciones es lo que se le entrega al
--     cliente, y un `client` de su organización lo lee; la aprobación dice
--     cuánto se aprobó gastar midiéndolo, y no hay motivo para esconderle eso.
--     Por eso no llevan la restrictiva de lectura de personal (`_role_read`).
--     Si la decisión es la otra, es una línea en `is_internal_surface()` de la
--     `0031`.
--     Y LO QUE NO SE PODÍA HACER DESDE ACÁ: la suite de la `0031` se pone roja
--     por vacuidad hasta que su fixture tenga una fila de cada tabla nueva en
--     sus dos organizaciones (su encabezado lo dice). Esa fixture vivía en el
--     PR #114; al integrar `main` en esta rama (2026-10-09, #114 ya mergeado)
--     se sumó ahí una aprobación, una corrida y una observación por
--     organización.
--
-- 12. EL LUGAR QUE SE BUSCA ES UN ID PÚBLICO DE PLACES, NO LA FICHA PROPIA.
--     `target_place_id` es texto con la forma de un id de Places, sin FK a nada
--     y sin columna de `businesses` de la que salga: la corrida mide la ficha que
--     diga el pedido, sea o no de la organización. Business Profile no aparece
--     en ningún lado —ni OAuth, ni `locations/N`, ni cuota—, y es a propósito:
--     Vulkan no va a tener Business Profile (Pablo, 2026-10-09), así que la
--     puerta se cruza midiendo una ficha pública ajena. `business_id` es el
--     negocio de Growth OS bajo el que la corrida queda archivada, que es lo
--     que ata la medición a un tenant.
--
-- 13. EL GASTO LO APRUEBA UNA PERSONA, EN UNA FILA, Y LA BASE CUENTA LOS CUPOS.
--     El acto humano de la puerta —«aprobación del gasto y tope de puntos por
--     corrida»— no existía en el código hasta el 2026-10-09, y dos revisiones
--     midieron lo que costaba: cualquiera que se registrara (el alta está
--     abierta y `handle_new_user` le da una organización con rol `owner`)
--     corría grillas con la clave de Places de la plataforma, y el único freno
--     de corridas era un rate limit en memoria, por IP y por instancia.
--     Ahora:
--       * `geo_grid_spend_approvals` es la aprobación: organización, `max_runs`
--         entre 1 y 3 (las tres corridas de la recomendación 11a), quién aprobó
--         —texto, porque quien aprueba el gasto de la agencia no tiene por qué
--         ser miembro de la organización que se mide— y una ventana de a lo
--         sumo 24 h. La escribe SÓLO `service_role` (decisión 9): una persona
--         con la llave del proyecto, nunca una sesión de la aplicación;
--       * cada corrida lleva `approval_id` y un CUPO `approval_slot`, entre 1 y
--         el `max_runs` de SU aprobación —por eso la FK compuesta trae
--         `max_runs` consigo— y ÚNICO por aprobación. Una cuarta corrida sobre
--         una aprobación de tres no entra: ni con 4 (CHECK), ni repitiendo un
--         cupo (UNIQUE), ni contra la aprobación de otra organización (FK por el
--         par). Y como la corrida se escribe ANTES de salir a la red, el cupo se
--         toma antes del primer peso;
--       * la aprobación no se puede achicar ni borrar con corridas colgadas
--         (`NO ACTION` en la FK): queda como el registro de quién autorizó esa
--         plata. La baja de la organización se lleva todo junto.
--     Que la ventana venza la mira la ruta, no la base: lo que la base garantiza
--     es la PLATA —nunca más de `max_runs` corridas por aprobación—; la ventana
--     es frescura.
--
-- 14. CADA OBSERVACIÓN ESTÁ EN EL PUNTO QUE EL PLAN LE DA A SU CELDA. La puerta
--     pide N observaciones «con coordenada» de una grilla DECLARADA, y hasta el
--     2026-10-09 nada ataba una cosa con la otra: la réplica aceptó una corrida
--     con centro en (59.3293, 18.0686) y nueve observaciones en (0, 0), y un
--     mutante de la ruta que consultaba el centro en los nueve puntos —la
--     grilla decorativa— pasaba la suite entera. Ahora la observación trae la
--     grilla de su corrida —`run_n_points`, `run_center_lat`, `run_center_lng`,
--     `run_step_m`— por la MISMA FK compuesta que la ata a la corrida (no hay
--     cómo copiar mal: la FK exige que el par exista tal cual), y dos CHECK:
--       * `geo_grid_observations_cell_check`: la celda dentro del lado de SU
--         corrida (decisión 4);
--       * `geo_grid_observations_coordinate_on_grid`: `lat`/`lng` a menos de
--         1e-6 grados (~0,1 m) del punto que `planificarGrilla`
--         (`src/lib/geo/grilla.ts`) le da a esa celda: desplazar el centro
--         `((lado − 1)/2 − fila) × paso` al norte y `(columna − (lado − 1)/2) ×
--         paso` al este sobre la esfera de radio 6 371 008,8 m, la longitud
--         comparada módulo 360. Es la misma cuenta, escrita en SQL; el bloque
--         309 la mide contra coordenadas que CALCULÓ el código de la ruta, no
--         contra una copia de esta fórmula.
--     Y como la FK no tiene `ON UPDATE`, mover el centro, el paso o N de una
--     corrida con observaciones muere: el mapa no se puede reubicar después de
--     medido.
--
-- QUÉ NO HACE
--
-- * No aplica nada a hosted (`tpqiltnskfeycnybczgz`): llevarlo a la base
--   desplegada es un acto aparte, con el ritual de
--   `feedback_aplicar_por_mcp_con_guarda`.
-- * No llama a Google ni gasta: las tres corridas con gasto las corre la sesión
--   directora con la sesión de Pablo.
-- * No impide que una corrida cambie de organización con un UPDATE de
--   `service_role` cuando no tiene observaciones ni persona: es la decisión 12.b
--   de la `0029`, por el mismo motivo. Con una observación colgada, el UPDATE
--   muere: la hija referencia el par viejo.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 300 a 311 de `supabase/qa/defects_test.sql`:
--
--   300  cruce entre organizaciones: negocio, persona y corrida de otra → 23503
--        nombrando cada FK compuesta;
--   301  su control positivo: las mismas sentencias, coherentes, pasan;
--   302  coherencia de resultado, posición y código → 23514 nombrando el CHECK,
--        con sus tres controles positivos;
--   303  el tope en la base: 16 puntos, la celda (3, 0), la celda repetida y un
--        «no aparece» dentro del rango de posiciones;
--   304  aislamiento de lectura: otra identidad lee 0 filas, y no por error;
--   305  su contraprueba: la dueña lee las suyas;
--   306  `anon` y `authenticated` no escriben —por privilegio, de tabla y de
--        columna, y por intento—, y `anon` tampoco lee;
--   307  por catálogo, sobre el subárbol (`geo_grid_` más todo lo que lo
--        referencia por FK): toda FK lleva `organization_id` emparejado con el
--        tenant del otro lado, toda tabla tiene `organization_id` NOT NULL,
--        ENABLE y FORCE y sus dos policies IGUALES a la forma canónica;
--   308  la baja de la organización con la grilla poblada pasa y no deja nada, y
--        la baja de quien corrió anula `created_by` y deja la corrida;
--   309  la coordenada: las nueve que calculó `planificarGrilla` entran; el
--        centro escrito en una esquina, un punto corrido 10 m y la corrida
--        movida con observaciones colgadas, no (decisión 14);
--   310  la celda contra el N de SU corrida: una corrida de 1 y una de 4 no
--        aceptan celdas de la de 9, y la grilla de la corrida no se puede
--        copiar mal en la observación (decisiones 4 y 14);
--   311  el cupo: sin aprobación, sobre la de otra organización, con el cupo 4
--        de una de 3, con un cupo repetido, una aprobación de 4 corridas o de
--        48 h, achicarla o borrarla con corridas colgadas → rechazo nombrando
--        su constraint; y el control, un cupo libre, entra (decisión 13).
--
-- MEDIDO ROMPIÉNDOLO (2026-10-08, y vuelto a medir entero el 2026-10-09 en la
-- réplica `growthos-replica-h2go3`, con los mismos resultados), una mutación por
-- vez, cada una sobre una base NUEVA —plantilla con la `0001` a la `0030`, esta
-- migración mutada, `app_role.sql`— y el archivo entero de aserciones (152).
-- Ninguna sobrevivió:
--
--   sin mutar (el control) . . . . . . . . . . . . . . verde, 152
--   el negocio por FK simple a `businesses (id)`  . . . rojo 300, 307
--   quien corrió por FK simple a `auth.users (id)`  . . rojo 300, 307, 308
--   la observación por FK simple a la corrida . . . . . rojo 300, 307
--   `position` sin el `IS NOT NULL` de su CHECK . . . . rojo 302 (fue el defecto
--                                                       real de la primera
--                                                       versión, ver el CHECK)
--   un `failed` sin código permitido  . . . . . . . . . rojo 302
--   el código de error como texto libre . . . . . . . . rojo 302
--   el tope en `BETWEEN 1 AND 16` . . . . . . . . . . . rojo 303
--   sin la celda única  . . . . . . . . . . . . . . . . rojo 303
--   «no aparece» dentro del rango (`BETWEEN 1 AND 100`)  rojo 303
--   sin FORCE . . . . . . . . . . . . . . . . . . . . . rojo 6, 307
--   la permisiva de lectura `USING (true)`  . . . . . . rojo 307 (la restrictiva
--                                                       la tapa en la
--                                                       conducta: por eso el
--                                                       catálogo)
--   la restrictiva `USING (true) WITH CHECK (true)` . . rojo 307
--   `GRANT ... INSERT ... TO authenticated` . . . . . . rojo 306
--   `GRANT SELECT ... TO anon`  . . . . . . . . . . . . rojo 306
--   quien corrió en CASCADE en vez de SET NULL  . . . . rojo 308
--   quien corrió que se NIEGA (`NO ACTION`) . . . . . . rojo 308
--
-- Y el `.down`, contra `supabase/qa/rollback.sh 0032_geo_grid` (seis más, todas
-- en rojo): sin el LOCK antes de contar, aceptando cualquier permiso no vacío,
-- sin borrar su fila de `schema_migrations`, sin consumir el permiso, sin mirar
-- si el permiso viene de PGOPTIONS, y sin la negativa.
--
-- LA RONDA DE ARREGLOS DEL 2026-10-09 (decisiones 13 y 14, y la celda de la 4),
-- medida igual en la réplica `growthos-replica-h2go3` —plantilla con la `0001`
-- a la `0030`, esta migración mutada, `app_role.sql` y el archivo entero de
-- aserciones (155)—. Ninguna sobrevivió:
--
--   sin mutar (el control) . . . . . . . . . . . . . . verde, 155
--   sin el CHECK de la coordenada . . . . . . . . . . . rojo 309
--   la fila con el signo al revés en ese CHECK  . . . . la fixture del 300 muere:
--                                                       23514 sobre coordenadas
--                                                       de `planificarGrilla`
--   la longitud sin el módulo 360 . . . . . . . . . . . rojo 309 (antimeridiano)
--   la celda en 0..2 sin mirar N (la versión vieja) . . rojo 310
--   la FK de la observación sólo por el par . . . . . . rojo 309, 310
--   sin la única del cupo . . . . . . . . . . . . . . . rojo 311
--   el cupo contra un 4 fijo  . . . . . . . . . . . . . rojo 311
--   la FK de la aprobación sin `max_runs` . . . . . . . rojo 311
--   `max_runs` hasta 10 . . . . . . . . . . . . . . . . rojo 311
--   la ventana de la aprobación sin tope  . . . . . . . rojo 311
--   `GRANT INSERT` de la aprobación a `authenticated` . rojo 306
--   la aprobación borrada en cascada con sus corridas . rojo 311
--
-- Y `rollback.sh 0032_geo_grid` otra vez, con la siembra nueva —aprobación,
-- corrida de un punto y su observación—: los cinco pasos en verde.
--
-- Con la `0031` (PR #114, todavía abierto), aplicada antes Y después de ésta
-- sobre bases nuevas (2026-10-09): en los dos órdenes cada tabla de la grilla
-- termina con las mismas cinco policies —`_read_member`, `_tenant_axis` y las
-- tres `_role_*` restrictivas—, que es lo que promete la decisión 11. Vuelto a
-- medir el mismo día con la `0031` de `main` (#114 ya mergeado) y las TRES
-- tablas: cinco policies en cada una, con el mismo texto en los dos órdenes.

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. La aprobación de gasto (decisión 13)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_grid_spend_approvals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,

    -- Cuántas corridas paga esta aprobación. Recomendación 11a: tres.
    max_runs         integer NOT NULL,

    -- Quién aprobó, en palabras: una persona, no una sesión (decisión 13).
    approved_by      text NOT NULL,
    approved_at      timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,

    CONSTRAINT geo_grid_spend_approvals_max_runs_check
        CHECK (max_runs BETWEEN 1 AND 3),

    CONSTRAINT geo_grid_spend_approvals_approved_by_not_blank
        CHECK (btrim(approved_by) <> '' AND char_length(approved_by) <= 200),

    -- Una aprobación es para una sesión de trabajo, no un permiso permanente.
    CONSTRAINT geo_grid_spend_approvals_window_check
        CHECK (expires_at > approved_at AND expires_at <= approved_at + interval '24 hours'),

    -- Destino de la FK de las corridas: el par y `max_runs`, para que el CHECK
    -- del cupo de la corrida lea el tope de SU aprobación.
    CONSTRAINT geo_grid_spend_approvals_runs_key UNIQUE (organization_id, id, max_runs),

    CONSTRAINT geo_grid_spend_approvals_organization_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.geo_grid_spend_approvals IS
    'Aprobación de gasto de la grilla (H2-GO-3): cuántas corridas (1 a 3) puede pagar una organización, quién lo aprobó y hasta cuándo. La escribe sólo service_role (decisión 13 de la 0032).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La corrida
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_grid_runs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL,
    business_id       uuid NOT NULL,

    keyword           text NOT NULL,
    target_place_id   text NOT NULL,

    -- La grilla declarada (decisión 4).
    center_lat        double precision NOT NULL,
    center_lng        double precision NOT NULL,
    radius_m          integer NOT NULL,
    step_m            integer NOT NULL,
    n_points          integer NOT NULL,

    -- Decisiones 5 y 6.
    unmatched_value   integer NOT NULL DEFAULT 21,
    declared_shift_m  integer,

    -- Decisión 13: la aprobación que la paga, su tope y el cupo que toma.
    approval_id       uuid NOT NULL,
    approval_max_runs integer NOT NULL,
    approval_slot     integer NOT NULL,

    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz,

    -- Decisión 2. Sin REFERENCES acá: la FK va contra el PAR, más abajo.
    created_by        uuid,

    CONSTRAINT geo_grid_runs_keyword_not_blank
        CHECK (btrim(keyword) <> '' AND char_length(keyword) <= 200),

    -- La forma de un place id de Google: base64url, sin espacios ni barras.
    CONSTRAINT geo_grid_runs_target_place_id_shape
        CHECK (target_place_id ~ '^[A-Za-z0-9_-]{10,255}$'),

    CONSTRAINT geo_grid_runs_center_check
        CHECK (center_lat BETWEEN -90 AND 90 AND center_lng BETWEEN -180 AND 180),

    -- El rango de `locationBias.circle.radius` que publica Google: [0, 50000] m.
    -- Cero no sesga nada, así que el piso es 1.
    CONSTRAINT geo_grid_runs_radius_check
        CHECK (radius_m BETWEEN 1 AND 50000),

    CONSTRAINT geo_grid_runs_step_check
        CHECK (step_m BETWEEN 1 AND 50000),

    -- EL TOPE (decisión 4): grillas cuadradas de lado 1, 2 o 3.
    CONSTRAINT geo_grid_runs_n_points_check
        CHECK (n_points IN (1, 4, 9)),

    CONSTRAINT geo_grid_runs_unmatched_value_check
        CHECK (unmatched_value BETWEEN 21 AND 100),

    CONSTRAINT geo_grid_runs_declared_shift_check
        CHECK (declared_shift_m IS NULL OR declared_shift_m BETWEEN 1 AND 100000),

    CONSTRAINT geo_grid_runs_finished_after_start
        CHECK (finished_at IS NULL OR finished_at >= started_at),

    -- Decisión 13: el cupo, entre 1 y el tope de SU aprobación, y uno por cupo.
    CONSTRAINT geo_grid_runs_approval_slot_check
        CHECK (approval_slot BETWEEN 1 AND approval_max_runs),
    CONSTRAINT geo_grid_runs_approval_slot_key UNIQUE (approval_id, approval_slot),

    -- Destino de la FK de las observaciones, con la grilla declarada (decisión
    -- 14). `id` ya es PK; esto existe porque una FK compuesta necesita una única
    -- sobre exactamente sus columnas.
    CONSTRAINT geo_grid_runs_grid_key
        UNIQUE (organization_id, id, n_points, center_lat, center_lng, step_m),

    CONSTRAINT geo_grid_runs_organization_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id) ON DELETE CASCADE,

    -- Decisión 1.
    CONSTRAINT geo_grid_runs_business_fkey
        FOREIGN KEY (organization_id, business_id)
        REFERENCES public.businesses (organization_id, id) ON DELETE CASCADE,

    -- Decisión 2. La lista de columnas del SET NULL es lo que impide que
    -- PostgreSQL anule también `organization_id`, que es NOT NULL.
    CONSTRAINT geo_grid_runs_creator_member_fkey
        FOREIGN KEY (organization_id, created_by)
        REFERENCES public.org_members (organization_id, user_id)
        ON DELETE SET NULL (created_by),

    -- Decisión 13. Sin ON DELETE ni ON UPDATE: una aprobación con corridas no
    -- se borra ni se achica. La baja de la organización se lleva las dos.
    CONSTRAINT geo_grid_runs_approval_fkey
        FOREIGN KEY (organization_id, approval_id, approval_max_runs)
        REFERENCES public.geo_grid_spend_approvals (organization_id, id, max_runs)
);

COMMENT ON TABLE public.geo_grid_runs IS
    'Grilla geográfica (H2-GO-3): una fila por corrida, con la grilla DECLARADA (centro, radio, paso, N) y el valor fijo de «no aparece». Ver el encabezado de la 0032.';

COMMENT ON COLUMN public.geo_grid_runs.declared_shift_m IS
    'Desplazamiento entre centros que la prueba A/A''/B declara ANTES de correr, en metros. NULL en una corrida suelta (decisión 6 de la 0032).';

CREATE INDEX IF NOT EXISTS geo_grid_runs_org_business_started_idx
    ON public.geo_grid_runs (organization_id, business_id, started_at DESC);
CREATE INDEX IF NOT EXISTS geo_grid_runs_org_creator_idx
    ON public.geo_grid_runs (organization_id, created_by);
CREATE INDEX IF NOT EXISTS geo_grid_runs_org_approval_idx
    ON public.geo_grid_runs (organization_id, approval_id, approval_max_runs);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La observación
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_grid_observations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    run_id           uuid NOT NULL,

    -- La grilla de su corrida, traída por la FK compuesta (decisión 14).
    run_n_points     integer NOT NULL,
    run_center_lat   double precision NOT NULL,
    run_center_lng   double precision NOT NULL,
    run_step_m       integer NOT NULL,

    -- La celda, fila 0 al norte y columna 0 al oeste.
    grid_row         integer NOT NULL,
    grid_col         integer NOT NULL,

    -- La coordenada que se le mandó a Google para ESTE punto.
    lat              double precision NOT NULL,
    lng              double precision NOT NULL,

    observed_at      timestamptz NOT NULL,
    source           text NOT NULL DEFAULT 'google_places_text_search',

    outcome          text NOT NULL,
    position         integer,
    error_code       text,

    -- Decisión 4: la celda dentro del lado de SU corrida. Con N en {1, 4, 9},
    -- «fila < √N» es «(fila + 1)² ≤ N», en enteros.
    CONSTRAINT geo_grid_observations_cell_check
        CHECK (grid_row >= 0 AND grid_col >= 0
               AND (grid_row + 1) * (grid_row + 1) <= run_n_points
               AND (grid_col + 1) * (grid_col + 1) <= run_n_points),

    CONSTRAINT geo_grid_observations_coordinate_check
        CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180),

    -- Decisión 14: el punto que `planificarGrilla` le da a esta celda, a menos
    -- de 1e-6 grados. Norte: ((lado − 1)/2 − fila) × paso; este: (columna −
    -- (lado − 1)/2) × paso, dividido por el coseno de la latitud del centro.
    -- La longitud se compara módulo 360: el código la normaliza a [-180, 180).
    CONSTRAINT geo_grid_observations_coordinate_on_grid
        CHECK (
            abs(lat - (run_center_lat
                       + degrees(((sqrt(run_n_points::double precision) - 1) / 2 - grid_row)
                                 * run_step_m / 6371008.8)))
                <= 1e-6
            AND abs(mod((lng - (run_center_lng
                                + degrees((grid_col - (sqrt(run_n_points::double precision) - 1) / 2)
                                          * run_step_m
                                          / (6371008.8 * cos(radians(run_center_lat))))))::numeric
                        + 540, 360) - 180)
                <= 1e-6
        ),

    -- Decisión 7.
    CONSTRAINT geo_grid_observations_source_check
        CHECK (source = 'google_places_text_search'),

    CONSTRAINT geo_grid_observations_outcome_check
        CHECK (outcome IN ('position', 'absent', 'failed')),

    -- LOS TRES ESTADOS, CADA UNO CON LO SUYO Y NADA MÁS. Ver el encabezado.
    --
    -- El `position IS NOT NULL` NO sobra, y lo dijo el bloque 302 en su primera
    -- corrida (2026-10-08): sin él, `position BETWEEN 1 AND 20` con la posición
    -- en NULL da NULL y no falso, el OR entero da NULL, y un CHECK que da NULL
    -- PASA. Una observación «aparece» sin posición entraba.
    CONSTRAINT geo_grid_observations_outcome_coherent
        CHECK (
            (outcome = 'position' AND position IS NOT NULL AND position BETWEEN 1 AND 20
                                  AND error_code IS NULL)
         OR (outcome = 'absent'   AND position IS NULL        AND error_code IS NULL)
         OR (outcome = 'failed'   AND position IS NULL        AND error_code IS NOT NULL)
        ),

    -- Decisión 8.
    CONSTRAINT geo_grid_observations_error_code_shape
        CHECK (error_code IS NULL
               OR error_code ~ '^(http_[1-5][0-9]{2}|timeout|network|invalid_response|missing_key)$'),

    -- Decisión 4: una corrida no tiene dos observaciones de la misma celda.
    CONSTRAINT geo_grid_observations_cell_key
        UNIQUE (organization_id, run_id, grid_row, grid_col),

    -- Decisiones 3 y 14: el par, y con él la grilla de la corrida. Sin ON
    -- UPDATE: una corrida con observaciones no se mueve.
    CONSTRAINT geo_grid_observations_run_fkey
        FOREIGN KEY (organization_id, run_id, run_n_points, run_center_lat, run_center_lng, run_step_m)
        REFERENCES public.geo_grid_runs (organization_id, id, n_points, center_lat, center_lng, step_m)
        ON DELETE CASCADE
);

COMMENT ON TABLE public.geo_grid_observations IS
    'Una observación por punto de una corrida de grilla: coordenada, hora, fuente, y position (1..20), absent o failed con su código. Un fallo nunca se escribe como absent (0032).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: ENABLE y FORCE en las tres, y los privilegios (decisión 9)
-- ─────────────────────────────────────────────────────────────────────────────
-- Un bucle, por el motivo de la §5 de la `0026`: dos copias del mismo par de
-- policies es el caso donde una se separa de su hermana sin que nada lo diga.
-- Lo que prueba que corrió sobre las TRES no es esta lista: es el bloque 307,
-- que descubre las tablas por catálogo.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['geo_grid_spend_approvals', 'geo_grid_runs', 'geo_grid_observations']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read_member', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I
               FOR SELECT TO authenticated
               USING (organization_id IN (SELECT public.current_user_org_ids()))',
            t || '_read_member', t);

        -- La RESTRICTIVA sigue valiendo el día que alguien agregue una permisiva
        -- de más: las permisivas se suman, las restrictivas se multiplican.
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_axis', t);
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El eje de rol de la `0031`, si la `0031` está aplicada (decisión 11)
-- ─────────────────────────────────────────────────────────────────────────────
-- Las mismas tres restrictivas que el bucle de la `0031` le pone a toda tabla
-- con `organization_id` que una sesión alcanza, con su texto. Sin `_role_read`:
-- las tres tablas son de cara al cliente.
DO $$
DECLARE
    t text;
BEGIN
    IF to_regprocedure('public.current_user_writer_org_ids()') IS NULL THEN
        RETURN;
    END IF;

    FOREACH t IN ARRAY ARRAY['geo_grid_spend_approvals', 'geo_grid_runs', 'geo_grid_observations']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_role_insert', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_role_update', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_role_delete', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO public
               WITH CHECK (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            t || '_role_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO public
               USING (organization_id IN (SELECT public.current_user_writer_org_ids()))
               WITH CHECK (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            t || '_role_update', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO public
               USING (organization_id IN (SELECT public.current_user_writer_org_ids()))',
            t || '_role_delete', t);
    END LOOP;
END
$$;

INSERT INTO public.schema_migrations (version) VALUES ('0032_geo_grid')
ON CONFLICT (version) DO NOTHING;

COMMIT;
