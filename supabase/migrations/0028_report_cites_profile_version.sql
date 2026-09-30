-- 0028_report_cites_profile_version.sql — el reporte dice contra qué versión de la ficha se escribió.
--
-- QUÉ AGREGA
--
-- Una columna en `reports` (`profile_version_id`), la FK compuesta que la ata a
-- `company_profiles`, un índice y un trigger. Ninguna tabla.
--
-- Es la mitad de esquema del tramo B de H1.2. La `0027` hizo que una versión
-- publicada no se pueda editar; esto hace que un reporte la CITE, y que la cita
-- sea algo que la base garantiza y no un texto dentro del JSON de `content`.
--
-- POR QUÉ UNA COLUMNA Y NO SÓLO EL CAMPO EN EL JSON
--
-- El orquestador ya guarda el reporte entero en `reports.content` como texto. Un
-- `profileVersion.id` dentro de ese texto es una cadena: nada impide que apunte a
-- una versión que no existe, a una de otra organización, o a un borrador que
-- después alguien reescribe. La puerta dice «un reporte generado cita un
-- version_id que RESUELVE a esa fila exacta», y resolver es lo que hace una FK.
-- El JSON lleva la cita para el lector; la columna la lleva para la base, y el
-- orquestador escribe las dos desde la misma variable.
--
-- CÓMO FALLA
--
-- Rojo en los bloques 104 a 109 de `supabase/qa/defects_test.sql`:
--
--   * el 104 cita una versión de OTRA organización y exige 23503 exacto: la FK
--     compuesta, no una policy;
--   * el 105 cita un BORRADOR y exige 45004: un borrador se puede reescribir
--     después, así que citarlo es exactamente «la cita resuelve a un texto que
--     cambió»;
--   * el 106 es la puerta, la mitad (c): cambiar la ficha —publicar la versión 2,
--     que pasa la 1 a superada— y regenerar el mismo reporte cita un id distinto,
--     y cada cita resuelve a su fila con el contenido de cuando se citó;
--   * el 107 cambia o quita la cita de un reporte ya guardado y exige 45004;
--   * el 108 es el control positivo del 105: una versión superada SÍ se puede
--     citar (un reporte viejo que se re-guarda, o una migración de datos);
--   * el 109 da de baja a la empresa con un reporte que cita su versión publicada,
--     y exige que la baja ENTRE y se lleve todo.
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
-- 2. LA FK VA CONTRA EL PAR, COMO TODAS DESDE LA `0004`. `(organization_id,
--    profile_version_id)` contra `company_profiles (organization_id, id)`: un
--    reporte de la organización A no puede citar la ficha de la B, y lo dice
--    PostgreSQL con 23503. La única que la `0026` dejó para esto es
--    `company_profiles_organization_id_id_key`, que existe justamente para ser
--    destino de FK compuestas.
--
-- 3. `ON DELETE NO ACTION`, Y NO `RESTRICT` NI `CASCADE`. El caso que decide es
--    el del bloque 109: dar de baja una empresa borra en UNA sentencia sus
--    reportes y su ficha, por dos cascades distintos desde `businesses`.
--    `RESTRICT` se comprueba en el momento, en el orden en que el cascade visita
--    las filas, y podría rechazar la baja si la ficha cae antes que el reporte.
--    `NO ACTION` se comprueba al final de la sentencia, cuando los dos ya no
--    están. `CASCADE` sería peor: borrar una versión se llevaría los reportes que
--    la citan, o sea borraría historia para que una cita no quede colgando. Y el
--    borrado directo de una versión congelada ya lo rechaza el guard de la
--    `0027` antes de que la FK opine.
--
-- 4. SÓLO SE CITA UNA VERSIÓN CONGELADA. `published` o `superseded`, nunca
--    `draft`: la `0027` garantiza que las dos primeras no cambian, y un borrador
--    cambia por definición. Sin esto, la FK resolvería siempre —a una fila que
--    alguien reescribió—, que es el modo de fallo que la puerta nombra con otras
--    palabras. Es un trigger porque un CHECK no puede mirar otra tabla.
--
-- 5. UNA CITA GUARDADA NO CAMBIA. Cambiar o quitar el `profile_version_id` de un
--    reporte existente es reescribir contra qué se escribió un texto que ya se
--    entregó. Poner la cita por primera vez sobre un reporte que no la tenía sí
--    se puede —un reporte viejo que se completa—, siempre que cite una versión
--    congelada. `reports.content` no se congela acá: eso sería decidir que los
--    reportes son inmutables, y ésa no es la puerta H1.2.
--
-- 6. EL TRIGGER ES `SECURITY DEFINER`, POR LA MISMA RAZÓN QUE EN LA `0027`. Mira
--    el estado de la versión citada, y su respuesta no puede depender de lo que
--    el invocador ve. Si no encuentra la fila, NO decide: deja que la FK
--    compuesta rechace con 23503, que es el rechazo correcto para una versión
--    inexistente o de otro tenant, y el que el bloque 104 exige exacto.
--
-- 7. SQLSTATE 45004, PROPIO, al lado de los tres de la `0027`: una cita que no se
--    puede poner o no se puede cambiar. Un código distinto para que las
--    aserciones puedan pedirlo exacto.
--
-- QUÉ NO HACE
--
-- * No aplica nada a hosted. Y ACÁ HAY UN ORDEN QUE IMPORTA, escrito también en
--   el PR: el orquestador del tramo B escribe `profile_version_id` sólo cuando
--   hay una versión publicada que citar. Si el código se despliega sin la `0026`,
--   la lectura de la ficha falla, la cita queda en `error` y la columna no se
--   manda: el reporte se guarda como hoy. Pero con la `0026` y la `0027`
--   aplicadas y ESTA no, una empresa con versión publicada produce un INSERT con
--   una columna que no existe (42703), y desde el tramo B ese error ya no se
--   traga. Las tres se aplican juntas, antes de desplegar.
-- * No muestra la cita en la pantalla de reportes. Está en el JSON que devuelve
--   la ruta y en el Markdown que el cliente se lleva. La página se mudó a
--   `/app/reports` en el #103, sin mergear, y tocarla acá es un conflicto seguro.

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS profile_version_id uuid;

COMMENT ON COLUMN public.reports.profile_version_id IS
    'La versión de la ficha (company_profiles) contra la que se generó el reporte. NULL = no había versión publicada que citar; NO quiere decir que la lectura falló (eso lo dice el JSON). Sólo cita versiones congeladas y no cambia una vez puesta. Ver la 0028.';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reports_profile_version_fkey'
          AND conrelid = 'public.reports'::regclass
    ) THEN
        ALTER TABLE public.reports
            ADD CONSTRAINT reports_profile_version_fkey
            FOREIGN KEY (organization_id, profile_version_id)
            REFERENCES public.company_profiles (organization_id, id)
            ON DELETE NO ACTION;
    END IF;
END $$;

-- Con el tenant adelante, como todos los índices desde la `0004`: no existe
-- camino de búsqueda que no lleve el tenant encima.
CREATE INDEX IF NOT EXISTS reports_org_profile_version_idx
    ON public.reports (organization_id, profile_version_id);

CREATE OR REPLACE FUNCTION public.reports_cite_frozen_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
BEGIN
    -- Decisión 5: una cita guardada no cambia ni se quita.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.profile_version_id IS NOT DISTINCT FROM OLD.profile_version_id THEN
            RETURN NEW;
        END IF;
        IF OLD.profile_version_id IS NOT NULL THEN
            RAISE EXCEPTION
                'el reporte ya cita la version %: una cita guardada no se cambia ni se quita',
                OLD.profile_version_id
                USING ERRCODE = '45004';
        END IF;
    END IF;

    IF NEW.profile_version_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_status
    FROM public.company_profiles
    WHERE organization_id = NEW.organization_id
      AND id = NEW.profile_version_id;

    -- Decisión 6: sin fila, decide la FK compuesta (23503), no este trigger.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Decisión 4.
    IF v_status = 'draft' THEN
        RAISE EXCEPTION
            'un reporte no puede citar la version %: es un borrador y se puede reescribir despues',
            NEW.profile_version_id
            USING ERRCODE = '45004';
    END IF;

    RETURN NEW;
END
$$;

-- Como las cuatro de la `0027` (su decisión 11): los default privileges de
-- Supabase dan EXECUTE por nombre a los tres roles, y `FROM PUBLIC` solo no los
-- toca. El trigger dispara igual; el bloque 111 lo mide con sesión.
REVOKE ALL ON FUNCTION public.reports_cite_frozen_version()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reports_cite_frozen_version ON public.reports;
CREATE TRIGGER trg_reports_cite_frozen_version
    BEFORE INSERT OR UPDATE OF profile_version_id ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.reports_cite_frozen_version();
ALTER TABLE public.reports
    ENABLE ALWAYS TRIGGER trg_reports_cite_frozen_version;

INSERT INTO public.schema_migrations (version) VALUES ('0028_report_cites_profile_version')
ON CONFLICT (version) DO NOTHING;
