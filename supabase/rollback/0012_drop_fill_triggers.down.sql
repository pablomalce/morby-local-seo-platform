-- 0012_drop_fill_triggers.down.sql
--
-- La 0012 sacó los diez triggers que rellenaban `organization_id` desde el padre,
-- y la función que los sostenía. Volver atrás los repone.
--
-- QUÉ SIGNIFICA REPONERLOS. Esos triggers existían para que una aplicación que se
-- olvidara del tenant igual escribiera filas válidas. La 0012 los sacó porque esa
-- comodidad escondía el olvido: el bloque 13 de la suite mide justamente que el
-- tenant lo ponga la aplicación y no un trigger. Con esta vuelta atrás, ese
-- bloque vuelve a poder pasar por el motivo equivocado.
--
-- La función se recrea textualmente como la escribió la 0004 —PostgreSQL guarda
-- el cuerpo tal cual y la huella lo compara así, de modo que un comentario de
-- menos deja la base distinta del repositorio—. Y los grants de EXECUTE que la
-- 0007 le había dado también, porque desaparecieron con ella.

\set ON_ERROR_STOP on

create or replace function public.fill_organization_id_from_business()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is null and new.business_id is not null then
    select b.organization_id into new.organization_id
      from public.businesses b
     where b.id = new.business_id;
  end if;
  return new;
end;
$$;

GRANT EXECUTE ON FUNCTION public.fill_organization_id_from_business()
    TO anon, authenticated, service_role;

-- Y a `growthos_app`, que NO se lo dio ninguna migración: se lo da
-- `supabase/qa/app_role.sql` con un `GRANT EXECUTE ON ALL FUNCTIONS`, y ese
-- archivo corre ANTES de la migración que se prueba. Al tirar la función, el
-- grant se fue con ella; recrearla sin esto deja la huella con una entrada de
-- menos. Lo dijo `rollback.sh`, nombrando la ACL entera:
--
--     < execute fill_organization_id_from_business ... growthos_app=X/postgres
--     > execute fill_organization_id_from_business ...
--
-- Guardado porque el rol es de QA y de hosted, no del esquema: una base que no lo
-- tenga no debe fallar acá.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
    GRANT EXECUTE ON FUNCTION public.fill_organization_id_from_business() TO growthos_app;
  END IF;
END
$$;

-- Las diez tablas, en el mismo orden en que la 0012 las nombra.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_locations', 'business_services', 'competitors', 'reviews',
    'content_assets', 'social_image_assets', 'campaigns', 'platform_tasks',
    'reports', 'agent_runs'
  ]
  LOOP
    EXECUTE format(
      'create trigger trg_%s_fill_org before insert on public.%I
         for each row execute function public.fill_organization_id_from_business()',
      t, t);
  END LOOP;
END
$$;

DELETE FROM public.schema_migrations WHERE version = '0012_drop_fill_triggers';
