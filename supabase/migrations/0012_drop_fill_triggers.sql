-- 0012_drop_fill_triggers.sql — el tenant deja de ponerlo un trigger.
--
-- QUÉ CIERRA
--
-- `fill_organization_id_from_business()` llenaba `organization_id` en un
-- BEFORE INSERT sobre diez tablas hijas porque la aplicación nunca mandaba la
-- columna. La 0004 los creó por eso, y la 0006 dejó escrito que no los tocaba.
--
-- El PR #23 hizo que los seis sitios de INSERT manden el tenant explícito, y
-- `src/lib/store/__tests__/tenantOnInsert.test.ts` es lo que los obliga a
-- seguir mandándolo: lee el argumento exacto de cada `.insert(`, con paréntesis
-- balanceados y sin comentarios, y falla si alguno se lo deja al trigger.
--
-- Por qué importa más allá de la prolijidad: una columna `NOT NULL` es un hecho
-- que el catálogo hace cumplir; *"un trigger va a llegar primero"* no lo es.
-- Mientras el trigger fuera el que garantizaba el tenant, ninguna migración
-- podía validar la regla.
--
-- EL ORDEN, QUE NO ES NEGOCIABLE
--
-- Los INSERT corren en el navegador. Borrar los triggers antes de que el bundle
-- nuevo esté sirviendo no falla en el despliegue: una pestaña abierta con el
-- bundle viejo empieza a escribir filas sin tenant, en silencio.
--
-- Medido antes de escribir esto, no supuesto: el commit del #23 (771a702) se
-- desplegó a producción el 2026-08-20T07:08:07Z con estado `success`, y desde
-- entonces hubo trece despliegues de producción más encima. El último,
-- 13fb482, tiene a 771a702 como ancestro.
--
-- CÓMO ESTÁ ESCRITA
--
-- El conteo previo admite 10 (nunca se corrió) o 0 (ya se corrió), y aborta
-- ante cualquier otro número. Un estado a medias significa que alguien borró
-- triggers por fuera de una migración, y seguir adelante taparía eso.
--
-- El `DROP FUNCTION` va sin CASCADE a propósito. Si quedara un trigger vivo,
-- PostgreSQL se niega y nombra la dependencia; con CASCADE se lo llevaría
-- puesto sin que nadie se entere. Es la comprobación de que el bucle de arriba
-- alcanzó a los diez.
--
-- El `GRANT EXECUTE` que la 0007 le dio a los tres roles desaparece con la
-- función: un privilegio no sobrevive al objeto.
--
-- El bloque 13 de `supabase/qa/defects_test.sql` va dado vuelta en el mismo
-- commit. Hasta hoy fallaba si los triggers NO estaban; ahora falla si están.

\set ON_ERROR_STOP on

do $$
declare
  presentes int;
begin
  select count(*) into presentes
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgname like '%fill_org%';

  if presentes not in (0, 10) then
    raise exception
      'se esperaban 10 triggers de relleno, o 0 si esta migracion ya corrio; hay %',
      presentes;
  end if;
end $$;

-- Las nueve de la 0004 y agent_runs, que allá se trató aparte por tener
-- business_id nulable. Acá el paso es idéntico para las diez, así que van
-- juntas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_locations', 'business_services', 'competitors', 'reviews',
    'content_assets', 'social_image_assets', 'campaigns', 'platform_tasks',
    'reports', 'agent_runs'
  ]
  loop
    execute format('drop trigger if exists trg_%s_fill_org on public.%I', t, t);
  end loop;
end $$;

drop function if exists public.fill_organization_id_from_business();

INSERT INTO public.schema_migrations (version) VALUES ('0012_drop_fill_triggers')
ON CONFLICT (version) DO NOTHING;
