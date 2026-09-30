-- Revierte la 0028.
--
-- QUÉ SE PIERDE
--
-- La cita verificable: `reports.profile_version_id`, o sea contra qué versión de
-- la ficha se escribió cada reporte, dicho de una forma que la base garantiza.
-- Los reportes quedan enteros, y el JSON de `reports.content` sigue llevando
-- `profileCitation` con el id: se pierde la FK que prueba que ese id resuelve, no
-- el texto. Reconstruir la columna desde el JSON es posible y no está escrito.
--
-- Va ANTES que el .down de la `0027` si se revierten las dos: la FK de esta
-- apunta a `company_profiles`, que la `0027` no toca, pero el sentido de la cita
-- —que resuelva a un texto que no cambió— depende del guard de aquélla.
--
-- Y VA DESPUÉS DE REVERTIR EL CÓDIGO, si el orquestador del tramo B de H1.2
-- está desplegado. Ese orquestador manda `profile_version_id` cuando la empresa
-- tiene una versión publicada, y desde H1.2 no se traga el error del INSERT: con
-- la `0026` y la `0027` puestas y esta columna borrada, cada reporte de una
-- empresa con ficha publicada falla. Es la caída del orden de despliegue, al
-- revés, y la encontró la revisión adversarial del 2026-09-30.
--
-- EL ORDEN IMPORTA
--
-- El trigger antes que su función, y la FK y el índice antes que la columna. Sin
-- CASCADE, por la razón de siempre: si algo que esta migración no creó quedó
-- colgado de la columna, el rollback falla nombrándolo.

-- En una transacción y con `ON_ERROR_STOP` propio, como el .down de la `0026`:
-- a medias, este archivo dejaría los triggers sin su columna o la columna sin su
-- FK, y un `psql -f` a secas sigue de largo después de un error.
\set ON_ERROR_STOP on

BEGIN;

DROP TRIGGER IF EXISTS trg_reports_cite_frozen_version ON public.reports;
DROP TRIGGER IF EXISTS trg_reports_citation_is_fixed ON public.reports;
DROP FUNCTION IF EXISTS public.reports_cite_frozen_version();
DROP FUNCTION IF EXISTS public.reports_citation_is_fixed();

ALTER TABLE public.reports
    DROP CONSTRAINT IF EXISTS reports_profile_version_fkey;
DROP INDEX IF EXISTS public.reports_org_business_profile_version_idx;
ALTER TABLE public.reports
    DROP COLUMN IF EXISTS profile_version_id;

-- La única de tres columnas que la FK usaba de destino, DESPUÉS de la FK: sin
-- CASCADE, sacarla antes fallaría nombrando la dependencia, que es el punto.
ALTER TABLE public.company_profiles
    DROP CONSTRAINT IF EXISTS company_profiles_org_business_id_key;

DELETE FROM public.schema_migrations WHERE version = '0028_report_cites_profile_version';

COMMIT;
