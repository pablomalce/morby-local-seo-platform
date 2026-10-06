-- 0028_report_cites_profile_version.sql — el reporte dice contra qué versión de la ficha se escribió.
--
-- QUÉ AGREGA
--
-- Una columna en `reports` (`profile_version_id`), la FK compuesta que la ata a
-- `company_profiles` por organización Y EMPRESA, una única nueva en
-- `company_profiles` que esa FK necesita, un índice y dos triggers. Ninguna
-- tabla.
--
-- Es la mitad de esquema del tramo B de H1.2. La `0027` hizo que una versión
-- publicada no se pueda editar; esto hace que un reporte la CITE, y que la cita
-- sea algo que la base garantiza y no un texto dentro del JSON de `content`.
--
-- POR QUÉ UNA COLUMNA Y NO SÓLO EL CAMPO EN EL JSON
--
-- El orquestador ya guarda el reporte entero en `reports.content` como texto. Un
-- `profileVersion.id` dentro de ese texto es una cadena: nada impide que apunte a
-- una versión que no existe, a una de otra organización u otra empresa, o a un
-- borrador que después alguien reescribe. La puerta dice «un reporte generado
-- cita un version_id que RESUELVE a esa fila exacta», y resolver es lo que hace
-- una FK. El JSON lleva la cita para el lector; la columna la lleva para la base,
-- y el orquestador escribe las dos desde la misma variable.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 104 a 109 y 114 a 117 de `supabase/qa/defects_test.sql`:
--
--   * el 104 cita una versión de OTRA organización y el 114 una de OTRA EMPRESA
--     de la misma organización, y los dos exigen 23503 exacto: la FK compuesta;
--   * el 105 cita un BORRADOR y exige 45004;
--   * el 106 es la mitad (b) de la puerta en SQL: cada cita resuelve a su fila,
--     y lo que esa fila dice NO SE PUEDE cambiar después de citada;
--   * el 107 cambia o quita la cita de un reporte ya guardado y exige 45004;
--   * el 108 cita una versión SUPERADA desde un reporte de cuando estaba vigente
--     (control positivo del 105 y del 115);
--   * el 109 da de baja a una empresa cuyos reportes citan su ficha, y exige que
--     entre;
--   * el 115 cita una versión que no estaba vigente cuando se escribió el
--     reporte y exige 45004;
--   * el 116 intenta, desde otra organización, averiguar si una versión ajena es
--     un borrador, y exige que RLS conteste primero (42501);
--   * el 117 cita un borrador con un rol que NO ve `company_profiles`, que es
--     la única forma de medir que el trigger no depende de lo que el invocador
--     ve (decisión 6).
--
-- MEDIDO ROMPIÉNDOLO (2026-09-30), una mutación por vez contra las 117
-- aserciones, re-aplicando la `0027` y esta para restaurar. Ninguna sobrevivió:
--
--   la FK vuelve a dos columnas, sin la empresa . . rojo 114
--   el trigger de la cita, entero, pero BEFORE  . . rojo 116
--   el trigger pasa a SECURITY INVOKER  . . . . . . rojo 117
--   sin la regla de vigencia  . . . . . . . . . . . rojo 115
--   el borde de salida cerrado (>= pasa a >)  . . . rojo 115
--   el borde de entrada abierto (< pasa a <=) . . . rojo 115
--   sin la rama «es un borrador»  . . . . . . . . . rojo 105
--   la cita fija deja re-apuntar (sólo no quitar) . rojo 107
--   sin el RETURN NEW temprano de la cita fija  . . rojo 107
--   el AFTER re-juzga una cita que no cambió  . . . rojo 107
--   el ICP de una versión citada se reescribe . . . rojo 96, 106
--   sin el trigger de la cita congelada . . . . . . rojo 105, 106, 111, 115, 117
--
-- La fila del BEFORE decía «rojo 115, 116» en la primera tabla, y la segunda
-- ronda de la revisión mostró por qué: aquel mutante, además de ser BEFORE, no
-- tenía la regla de vigencia, y el 115 caía por eso. Con el trigger entero y
-- sólo movido a BEFORE —medido acá—, el único que lo ve es el 116, que es el que
-- existe para eso. Las filas de la rama de borrador, la re-cita y el re-juicio
-- son de la segunda ronda: con la suite de la primera, las tres sobrevivían. Las
-- dos de los bordes son de la tercera: la ventana es semiabierta y ningún caso
-- citaba en el instante exacto del relevo, así que las dos sobrevivían.
--
-- Y un arreglo que no vive en la suite, medido a mano en la réplica: re-aplicar
-- esta migración sobre la FK de dos columnas de su primera versión la deja de
-- tres y borra el índice viejo. Las fechas de las superadas después de un
-- `.down` ya no se reconstruyen en ningún lado —la `0027` se niega a aplicarse
-- sin ellas (su decisión 15)—, así que la regla de vigencia nunca trabaja sobre
-- una fecha adivinada.
--
-- Y la que la primera versión de este archivo decía cuidar y no cuidaba: con
-- `ON DELETE RESTRICT` en vez de `NO ACTION`, NADA se pone rojo, porque no hay
-- diferencia observable (decisión 3). Queda escrito para que nadie la agregue a
-- esta tabla.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LAS DECISIONES
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. NULLABLE, Y NULL QUIERE DECIR «NO HABÍA NADA QUE CITAR». Una empresa sin
--    versión publicada genera reportes igual —es el estado de todas hoy—, y
--    exigir la cita sería impedir el reporte. MATCH SIMPLE deja pasar el NULL. Lo
--    que el NULL NO puede significar es «no se pudo leer la ficha»: esa
--    distinción la lleva el JSON (`profileCitation.status`), porque son dos
--    cosas distintas y un NULL no distingue.
--
-- 2. LA FK VA CONTRA LA TERNA (organización, empresa, versión). La primera
--    versión de este archivo la puso contra el par `(organization_id, id)`, como
--    todas desde la `0004`, y la revisión adversarial del 2026-09-30 midió lo
--    que eso dejaba: un reporte de la empresa B2 citando la ficha de la B1 de la
--    misma organización —al insertarlo, o MOVIENDO un reporte citado con un
--    UPDATE de `business_id`, que ni siquiera disparaba el trigger—, y con eso
--    la B1 quedaba imposible de dar de baja (23503). `reports` ya lleva
--    `business_id`, así que la terna no desnormaliza nada: la FK
--    `(organization_id, business_id, profile_version_id)` contra
--    `company_profiles (organization_id, business_id, id)` hace imposible citar
--    fuera de la propia empresa, y se re-comprueba sola cuando alguien mueve el
--    reporte. La única nueva `company_profiles_org_business_id_key` existe para
--    ser su destino; no restringe nada —`id` ya es PK—, igual que la única de la
--    decisión 7 de la `0026`.
--
-- 3. `ON DELETE NO ACTION`, Y NO `CASCADE`. `CASCADE` borraría los reportes que
--    citan una versión cuando la versión se borra, o sea borraría historia para
--    que una cita no quede colgando. Entre `NO ACTION` y `RESTRICT` la
--    diferencia NO se ve acá, y la primera versión de este archivo afirmaba lo
--    contrario: decía que `RESTRICT` «podría rechazar la baja si la ficha cae
--    antes que el reporte». Medido por la revisión y re-medido acá con la FK en
--    `RESTRICT` contra las 117 aserciones —todas verdes—, es falso PARA ESTE
--    CASO: los dos cascades salen del mismo `businesses`, a la misma
--    profundidad, y los chequeos que encolan sus borrados corren después de los
--    dos. No es una regla general del motor —la segunda ronda encontró un caso
--    donde el orden SÍ importa, con cascades a profundidades distintas: la FK
--    `published_by` de la `0026` impide borrar una organización con ficha
--    publicada, y eso es del #105, no de este archivo—. `NO ACTION` queda por ser el default y porque es
--    diferible si algún día hace falta; el bloque 109 mide que la baja entra, NO
--    la elección entre las dos, que acá no es observable.
--
-- 4. SÓLO SE CITA UNA VERSIÓN CONGELADA. `published` o `superseded`, nunca
--    `draft`: la `0027` garantiza que las dos primeras no cambian, y un borrador
--    cambia por definición.
--
-- 5. UNA CITA GUARDADA NO CAMBIA. Cambiar o quitar el `profile_version_id` de un
--    reporte existente es reescribir contra qué se escribió un texto que ya se
--    entregó. Poner la cita por primera vez sobre un reporte que no la tenía sí
--    se puede —un reporte viejo que se completa—, con la condición del punto 8.
--    `reports.content` no se congela acá: eso sería decidir que los reportes son
--    inmutables, y ésa no es la puerta H1.2.
--
-- 6. DOS TRIGGERS, UNO ANTES Y OTRO DESPUÉS DE RLS. La primera versión era uno
--    solo, `BEFORE`, `SECURITY DEFINER`, que miraba la versión citada. Medido por
--    la revisión: PostgreSQL corre los triggers `BEFORE ROW` ANTES del `WITH
--    CHECK` de RLS, así que un miembro de la organización A que escribía un
--    reporte con el `organization_id` de la B recibía 45004 si la versión de B
--    era un borrador y 42501 si no. Un oráculo entre tenants —justo lo que la
--    decisión 11 de la `0027` había cerrado para `company_profile_freeze_state`—
--    reabierto por otra puerta. Ahora:
--      * `reports_citation_is_fixed`, `BEFORE UPDATE OF profile_version_id`, sin
--        mirar ninguna otra tabla: compara OLD con NEW (punto 5). No sabe nada
--        que el que escribe no sepa.
--      * `reports_cite_frozen_version`, `AFTER INSERT OR UPDATE OF
--        profile_version_id, created_at`: mira la versión (puntos 4 y 8). Corre
--        DESPUÉS de RLS y después de la FK —los triggers de una FK se llaman
--        `RI_ConstraintTrigger_…` y los AFTER disparan en orden de nombre—, así
--        que para cuando pregunta, la fila ya es de la organización del que
--        escribe y la versión ya es de su empresa. Es `SECURITY DEFINER` porque su
--        respuesta no puede depender de lo que el invocador ve; el bloque 117 lo
--        mide con un rol que no ve `company_profiles`.
--
-- 7. SQLSTATE 45004, PROPIO, al lado de los tres de la `0027`: una cita que no se
--    puede poner o no se puede cambiar.
--
-- 8. LA VERSIÓN CITADA ESTABA VIGENTE CUANDO SE ESCRIBIÓ EL REPORTE:
--    `published_at <= created_at < coalesce(superseded_at, infinito)`. Sin esto,
--    el punto 5 dejaba «completar» un reporte de enero con una versión publicada
--    en septiembre, y la FK resolvía a una estrategia que el reporte nunca vio.
--    Por eso el trigger AFTER también mira `created_at`: cambiarle la fecha a un
--    reporte citado es otra forma de moverlo fuera de su versión. Y es lo que
--    hace que una versión insertada directamente como `superseded` sin haber
--    sido publicada no sea citable —aunque la decisión 13 de la `0027` ya no la
--    deja existir—. Tiene un costo que conviene saber: si alguien publica una
--    versión nueva ENTRE que el orquestador lee la vigente y guarda el reporte,
--    el INSERT muere con 45004 y el reporte falla una vez. Es correcto: ese
--    reporte iba a citar una versión que ya no estaba vigente.
--
--    Y TRES LÍMITES DE ESTA REGLA, medidos por la segunda ronda de la revisión:
--    * La carrera al revés NO se detecta: si la publicación empieza antes que el
--      INSERT del reporte y confirma después, el reporte queda guardado con un
--      `created_at` posterior al `superseded_at` de la versión que cita. Las dos
--      fechas son `now()`, que es el comienzo de cada transacción y no el orden
--      en que confirman, y leer la versión no la bloquea contra un cambio de
--      `status` (no es columna de clave). El reporte se escribió con el
--      contenido de esa versión, así que la cita dice la verdad; lo que queda
--      desalineado es la fecha.
--    * Las fechas las escribe quien publica, y nada las ata al reloj: un
--      `published_at` en el futuro hace que todo reporte de esa empresa muera
--      con 45004 hasta que el reloj lo alcance. Hoy ningún código publica; el
--      que lo haga tiene que usar el reloj de la base.
--    * Por las dos cosas de arriba, la regla se garantiza al CITAR, no para
--      siempre. Una cita guardada que queda fuera de su ventana —por la carrera
--      o por un `superseded_at` retroactivo— NO se vuelve a juzgar mientras no
--      cambie: el trigger sale temprano si ni la cita ni la fecha cambiaron. La
--      primera versión la re-juzgaba en cada reenvío de la fila, y ese reporte
--      quedaba sin poder recibir un PATCH nunca más.
--
-- QUÉ NO HACE
--
-- * No aplica nada a hosted. Y HAY UN ORDEN QUE IMPORTA, EN LAS DOS
--   DIRECCIONES:
--   - hacia adelante: el orquestador del tramo B escribe `profile_version_id`
--     sólo cuando hay una versión publicada que citar. Sin la `0026`, la lectura
--     de la ficha falla, la cita queda en `error` y la columna no viaja: el
--     reporte se guarda como hoy. Con la `0026` y la `0027` aplicadas y ESTA no,
--     una empresa con versión publicada produce un INSERT con una columna que no
--     existe, y desde el tramo B ese error ya no se traga. Las tres se aplican
--     juntas, antes de desplegar;
--   - hacia atrás: revertir SÓLO esta migración con el código del tramo B
--     desplegado es la misma caída al revés. El `.down` lo dice: primero se
--     revierte el código.
-- * No muestra la cita en la pantalla de reportes. Está en el JSON que devuelve
--   la ruta y en el Markdown que el cliente se lleva. La página se mudó a
--   `/app/reports` en el #103, sin mergear, y tocarla acá es un conflicto seguro.

BEGIN;

-- Esta migración confía en la `0027`: el trigger de la cita lee `superseded_at`,
-- que agrega ella, y la regla de vigencia sólo tiene sentido sobre versiones que
-- el guard congela. En orden de glob siempre va después, pero aplicada a mano
-- después de un `.down`, se podía aplicar sola —medido—, y entonces cada reporte
-- con cita moría con 42703 al guardarse. Se niega.
--
-- Y mira el ESQUEMA, no sólo el registro. La sexta ronda de la revisión midió
-- que un rollback fuera de orden (el .down de la `0026` con la `0027` todavía
-- puesta) deja la fila de la `0027` en `schema_migrations` sin nada de la
-- `0027` en las tablas, y la guarda que sólo leía el registro dejaba pasar.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.schema_migrations
                    WHERE version = '0027_profile_immutability')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'company_profiles'
                         AND column_name = 'superseded_at')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger
                       WHERE tgname = 'trg_company_profiles_immutable'
                         AND tgrelid = 'public.company_profiles'::regclass) THEN
        RAISE EXCEPTION 'la 0028 no se aplica sin la 0027 en el esquema (registro, superseded_at y el guard): aplicar primero la 0027';
    END IF;
END $$;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS profile_version_id uuid;

COMMENT ON COLUMN public.reports.profile_version_id IS
    'La versión de la ficha (company_profiles) de ESTA empresa contra la que se generó el reporte, vigente cuando se generó. NULL = no había versión publicada que citar; NO quiere decir que la lectura falló (eso lo dice el JSON). Sólo cita versiones congeladas y no cambia una vez puesta. Ver la 0028.';

-- Decisión 2: el destino de la FK de tres columnas.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'company_profiles_org_business_id_key'
          AND conrelid = 'public.company_profiles'::regclass
    ) THEN
        ALTER TABLE public.company_profiles
            ADD CONSTRAINT company_profiles_org_business_id_key
            UNIQUE (organization_id, business_id, id);
    END IF;
END $$;

-- Si la FK existe con DOS columnas —la forma de la primera versión de este
-- archivo, que alguna base de desarrollo pudo haber recibido—, se rehace. Sin
-- esto, re-aplicar la versión arreglada sobre la vieja dejaba la FK vieja en su
-- lugar, porque la guarda sólo miraba el nombre y el nombre no cambió; lo midió
-- la segunda ronda de la revisión adversarial. Lo mismo con el índice viejo.
DROP INDEX IF EXISTS public.reports_org_profile_version_idx;
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reports_profile_version_fkey'
          AND conrelid = 'public.reports'::regclass
          AND array_length(conkey, 1) <> 3
    ) THEN
        ALTER TABLE public.reports DROP CONSTRAINT reports_profile_version_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reports_profile_version_fkey'
          AND conrelid = 'public.reports'::regclass
    ) THEN
        ALTER TABLE public.reports
            ADD CONSTRAINT reports_profile_version_fkey
            FOREIGN KEY (organization_id, business_id, profile_version_id)
            REFERENCES public.company_profiles (organization_id, business_id, id)
            ON DELETE NO ACTION;
    END IF;
END $$;

-- Con el tenant adelante, como todos los índices desde la `0004`, y en el orden
-- de la FK: es el que usa la base para comprobarla cuando se borra una versión.
CREATE INDEX IF NOT EXISTS reports_org_business_profile_version_idx
    ON public.reports (organization_id, business_id, profile_version_id);

-- Decisión 5, antes de RLS y sin mirar ninguna otra tabla (decisión 6).
CREATE OR REPLACE FUNCTION public.reports_citation_is_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.profile_version_id IS NOT DISTINCT FROM OLD.profile_version_id THEN
        RETURN NEW;
    END IF;
    IF OLD.profile_version_id IS NOT NULL THEN
        RAISE EXCEPTION
            'el reporte ya cita la version %: una cita guardada no se cambia ni se quita',
            OLD.profile_version_id
            USING ERRCODE = '45004';
    END IF;
    RETURN NEW;
END
$$;

-- Decisiones 4 y 8, después de RLS y de la FK (decisión 6).
CREATE OR REPLACE FUNCTION public.reports_cite_frozen_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status        text;
    v_published_at  timestamptz;
    v_superseded_at timestamptz;
BEGIN
    IF NEW.profile_version_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Una cita que no cambió no se vuelve a juzgar. La regla de vigencia se
    -- comprueba al CITAR (o al mover la fecha del reporte), no cada vez que
    -- alguien reenvía la fila entera. Sin esto, un reporte cuya versión se superó
    -- DESPUÉS con fecha retroactiva, o en carrera con su propio INSERT, quedaba
    -- sin poder recibir un PATCH de fila entera nunca más; lo midió la segunda
    -- ronda de la revisión adversarial.
    IF TG_OP = 'UPDATE'
       AND NEW.profile_version_id IS NOT DISTINCT FROM OLD.profile_version_id
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
        RETURN NULL;
    END IF;

    SELECT status, published_at, superseded_at
      INTO v_status, v_published_at, v_superseded_at
      FROM public.company_profiles
     WHERE organization_id = NEW.organization_id
       AND business_id = NEW.business_id
       AND id = NEW.profile_version_id;

    -- Sin fila decide la FK, que corre antes que este trigger y ya habría
    -- levantado 23503. Llegar acá sin fila no debería pasar; si pasa, no es este
    -- trigger el que tiene que opinar.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_status = 'draft' THEN
        RAISE EXCEPTION
            'un reporte no puede citar la version %: es un borrador y se puede reescribir despues',
            NEW.profile_version_id
            USING ERRCODE = '45004';
    END IF;

    IF v_published_at IS NULL
       OR NEW.created_at < v_published_at
       OR (v_superseded_at IS NOT NULL AND NEW.created_at >= v_superseded_at) THEN
        RAISE EXCEPTION
            'el reporte es del % y la version % estuvo vigente del % al %: no pudo escribirse contra ella',
            NEW.created_at, NEW.profile_version_id, v_published_at, coalesce(v_superseded_at::text, 'hoy')
            USING ERRCODE = '45004';
    END IF;

    RETURN NULL;
END
$$;

-- Como las funciones de la `0027` (su decisión 11): los default privileges de
-- Supabase dan EXECUTE por nombre a los tres roles, y `FROM PUBLIC` solo no los
-- toca. Los triggers disparan igual; el bloque 111 lo mide con sesión.
REVOKE ALL ON FUNCTION public.reports_citation_is_fixed()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reports_cite_frozen_version()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reports_citation_is_fixed ON public.reports;
CREATE TRIGGER trg_reports_citation_is_fixed
    BEFORE UPDATE OF profile_version_id ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.reports_citation_is_fixed();
ALTER TABLE public.reports
    ENABLE ALWAYS TRIGGER trg_reports_citation_is_fixed;

DROP TRIGGER IF EXISTS trg_reports_cite_frozen_version ON public.reports;
CREATE TRIGGER trg_reports_cite_frozen_version
    AFTER INSERT OR UPDATE OF profile_version_id, created_at ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.reports_cite_frozen_version();
ALTER TABLE public.reports
    ENABLE ALWAYS TRIGGER trg_reports_cite_frozen_version;

INSERT INTO public.schema_migrations (version) VALUES ('0028_report_cites_profile_version')
ON CONFLICT (version) DO NOTHING;

COMMIT;
