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
-- EL ORDEN IMPORTA
--
-- El trigger antes que su función, y la FK y el índice antes que la columna. Sin
-- CASCADE, por la razón de siempre: si algo que esta migración no creó quedó
-- colgado de la columna, el rollback falla nombrándolo.

DROP TRIGGER IF EXISTS trg_reports_cite_frozen_version ON public.reports;
DROP FUNCTION IF EXISTS public.reports_cite_frozen_version();

ALTER TABLE public.reports
    DROP CONSTRAINT IF EXISTS reports_profile_version_fkey;
DROP INDEX IF EXISTS public.reports_org_profile_version_idx;
ALTER TABLE public.reports
    DROP COLUMN IF EXISTS profile_version_id;

DELETE FROM public.schema_migrations WHERE version = '0028_report_cites_profile_version';
