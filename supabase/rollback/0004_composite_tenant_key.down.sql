-- 0004_composite_tenant_key.down.sql
--
-- LO QUE SE PIERDE AL REVERTIR. La 0004 le dio a cada tabla hija su propia
-- columna `organization_id` y una clave foránea compuesta contra
-- `businesses (organization_id, id)`. Eso convirtió el defecto 5 de la 0003 —el
-- hijo que se muda de tenant en silencio detrás del padre— en algo que el motor
-- rechaza, sin trigger de por medio. Esta vuelta atrás lo deshace:
--
--   * las diez tablas hijas pierden `organization_id`. Vuelven a no saber a qué
--     tenant pertenecen: su tenant vuelve a ser el que el padre diga EN ESTE
--     INSTANTE, y cambiar `businesses.organization_id` vuelve a mudarlas a todas
--     de una sin una escritura en ninguna;
--   * las diez policies vuelven a resolver el tenant por subconsulta contra
--     `businesses`. Vuelve el costo —una subconsulta por fila leída— y vuelve el
--     agujero de que una fila con `business_id` NULL sea ilegible para todos;
--   * las cuatro claves compuestas de los NIETOS se van, y vuelven las simples.
--     Un competidor, una reseña o una imagen vuelven a poder apuntar a la
--     ubicación o al servicio de OTRO negocio;
--   * `content_assets_service_id_fkey` vuelve, al lado de la compuesta que puso
--     la 0003, que es como estaba antes de esta migración: dos foráneas donde
--     una es subconjunto estricto de la otra.
--
-- LO QUE SE REPONE, Y ES UN RETROCESO CONSCIENTE. La 0004 borró el trigger
-- `trg_businesses_no_reparenting` porque las claves compuestas lo reemplazaban.
-- Sin ellas ya no hay reemplazo, así que el trigger VUELVE: es la única barrera
-- que queda contra la mudanza de tenant, y dejarlo afuera sería revertir la 0004
-- y además reabrir el defecto 5 que la 0003 había cerrado.
--
-- Ojo con la diferencia, porque no es la misma barrera: el trigger rechaza TODA
-- mudanza, incluida la de un negocio sin hijos, que con las claves compuestas
-- estaba permitida. Volver atrás es, en ese punto, más estricto que la 0004.
--
-- LO QUE NO SE DESHACE. El backfill. La 0004 llenó `organization_id` en diez
-- tablas leyendo el padre; esta vuelta atrás tira la columna entera, así que ese
-- trabajo se pierde y volver a aplicar la 0004 lo hace de nuevo desde cero. No
-- hay dato de cliente en juego —el valor es derivable del padre—, pero en una
-- base grande son diez UPDATE de tabla completa que hay que pagar dos veces.
--
-- EL ORDEN NO ES ESTILO. Tres dependencias lo fijan:
--
--   1. las policies se reescriben ANTES de tirar la columna. Una policy que
--      nombra `organization_id` es un objeto que DEPENDE de ella, y PostgreSQL
--      rechaza el DROP COLUMN mientras exista;
--   2. las foráneas compuestas de los nietos apuntan a
--      `business_locations (business_id, id)`, que es un UNIQUE que esta misma
--      vuelta atrás borra: primero las foráneas, después el UNIQUE;
--   3. las diez `<tabla>_tenant_fkey` apuntan a
--      `businesses (organization_id, id)`: se van con la columna de cada hija,
--      y recién entonces se puede borrar ese UNIQUE.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. El trigger que la 0004 borró vuelve, textual como lo escribió la 0003
-- ─────────────────────────────────────────────────────────────────────────────
-- Textual y no equivalente: PostgreSQL guarda `prosrc` tal cual se escribió y
-- `schema_fingerprint.sql` lo compara con un md5, así que un espacio de más deja
-- la base distinta del repositorio aunque la función haga lo mismo.
create or replace function public.reject_business_reparenting()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception
      'A business cannot change organization: % child tables reference it by '
      'business_id alone and would follow it across tenants without a write of '
      'their own. Move the data explicitly, or add the composite tenant key '
      'first.', 10
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

-- Los grants que la función tenía antes de que la 0004 la borrara. Los de
-- `anon`, `authenticated` y `service_role` los repone sola la imagen —Supabase
-- deja `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS` puesto, y
-- `auth_stub.sql` lo replica—, pero se escriben igual: un `.down` no debe
-- depender de un default que la base de destino podría no tener.
GRANT EXECUTE ON FUNCTION public.reject_business_reparenting()
    TO anon, authenticated, service_role;

-- Y a `growthos_app`, que NO se lo dio ninguna migración: se lo da
-- `supabase/qa/app_role.sql` con un `GRANT EXECUTE ON ALL FUNCTIONS`, y ese
-- archivo corre ANTES de la migración que se prueba. Al borrar la función, ese
-- grant se fue con ella; recrearla sin esta línea deja la huella con una entrada
-- de menos. Es el mismo hallazgo que el .down de la 0012 dejó anotado.
--
-- Guardado porque el rol es de QA y de hosted, no del esquema: una base que no
-- lo tenga no debe fallar acá.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growthos_app') THEN
    GRANT EXECUTE ON FUNCTION public.reject_business_reparenting() TO growthos_app;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_businesses_no_reparenting ON public.businesses;
CREATE TRIGGER trg_businesses_no_reparenting
  BEFORE UPDATE OF organization_id ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.reject_business_reparenting();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Las diez policies vuelven a resolver el tenant por el padre
-- ─────────────────────────────────────────────────────────────────────────────
-- Primero de todo lo demás: mientras una policy nombre `organization_id`, la
-- columna no se puede tirar.
--
-- Nueve vuelven a la forma de la 0001. `agent_runs` NO: su policy en este punto
-- de la historia es la que dejó la 0003 —sin la rama `business_id is null or`—,
-- así que reponer la de la 0001 sería deshacer la 0003 de paso.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('business_locations',  'locations_rw_member'),
      ('business_services',   'services_rw_member'),
      ('competitors',         'competitors_rw_member'),
      ('reviews',             'reviews_rw_member'),
      ('content_assets',      'content_rw_member'),
      ('social_image_assets', 'images_rw_member'),
      ('campaigns',           'campaigns_rw_member'),
      ('platform_tasks',      'tasks_rw_member'),
      ('reports',             'reports_rw_member')
    ) AS v(tbl, pol)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.pol, p.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL
         USING (business_id in (
           select id from public.businesses
            where organization_id in (select public.current_user_org_ids())))
         WITH CHECK (business_id in (
           select id from public.businesses
            where organization_id in (select public.current_user_org_ids())))',
      p.pol, p.tbl);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS "runs_rw_member" ON public.agent_runs;
CREATE POLICY "runs_rw_member" ON public.agent_runs
  FOR ALL USING (
    business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  )
  WITH CHECK (
    business_id in (
      select id from public.businesses
      where organization_id in (select public.current_user_org_ids())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Los nietos vuelven a la clave simple
-- ─────────────────────────────────────────────────────────────────────────────
-- Las cuatro compuestas se van y vuelven las cinco simples de la 0001 —cuatro
-- reemplazadas más `content_assets_service_id_fkey`, que la 0004 borró sin
-- reemplazo por redundante con la compuesta de la 0003.
--
-- Los nombres importan tanto como las definiciones: la huella compara
-- `constraint <tabla>.<nombre>`, así que una foránea correcta con otro nombre
-- es una diferencia.
ALTER TABLE public.competitors
  DROP CONSTRAINT IF EXISTS competitors_location_same_business_fkey;
ALTER TABLE public.competitors
  ADD CONSTRAINT competitors_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES public.business_locations(id)
  ON DELETE SET NULL;

ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_location_same_business_fkey;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES public.business_locations(id)
  ON DELETE SET NULL;

ALTER TABLE public.social_image_assets
  DROP CONSTRAINT IF EXISTS social_image_assets_location_same_business_fkey;
ALTER TABLE public.social_image_assets
  ADD CONSTRAINT social_image_assets_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES public.business_locations(id)
  ON DELETE SET NULL;

ALTER TABLE public.social_image_assets
  DROP CONSTRAINT IF EXISTS social_image_assets_service_same_business_fkey;
ALTER TABLE public.social_image_assets
  ADD CONSTRAINT social_image_assets_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.business_services(id)
  ON DELETE SET NULL;

-- Y la quinta, que no reemplaza a ninguna compuesta de esta migración: la 0004
-- borró `content_assets_service_id_fkey` sin poner nada en su lugar, por ser
-- subconjunto estricto de la compuesta que la 0003 había agregado al lado. Al
-- revertir, la compuesta de la 0003 SIGUE puesta —deshacerla es trabajo del
-- .down de la 0003— así que reponer ésta devuelve el par redundante que había
-- antes de esta migración, que es lo que "dejar el esquema como estaba"
-- significa.
--
-- `ON DELETE SET NULL` es como la escribió la 0001, con la foránea en línea en
-- el CREATE TABLE; el nombre es el que PostgreSQL le da a una foránea en línea,
-- y la huella lo compara.
ALTER TABLE public.content_assets
  DROP CONSTRAINT IF EXISTS content_assets_service_id_fkey;
ALTER TABLE public.content_assets
  ADD CONSTRAINT content_assets_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.business_services(id)
  ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. agent_runs
-- ─────────────────────────────────────────────────────────────────────────────
-- La foránea vuelve a ser simple y sigue siendo ON DELETE SET NULL, que es lo
-- que la 0004 conservó al reemplazarla: borrar un negocio no borra el registro
-- de que un agente corrió contra él.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_tenant_fkey;
ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES public.businesses(id)
  ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_agent_runs_fill_org ON public.agent_runs;
ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_tenant_pair_complete;
DROP INDEX IF EXISTS public.idx_agent_runs_org_business;
ALTER TABLE public.agent_runs DROP COLUMN IF EXISTS organization_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Las nueve hijas con business_id NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────
-- El mismo bucle que la migración, al revés y en el mismo orden de nombres. La
-- foránea simple vuelve con ON DELETE CASCADE, que es como la escribió la 0001.
--
-- El DROP COLUMN se llevaría solo el índice y la foránea compuesta, y aun así se
-- nombran: un `.down` que depende de lo que el CASCADE implícito arrastre no dice
-- qué revierte, y el día que una de esas piezas quede referenciada por algo más
-- falla sin explicar por qué.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_locations', 'business_services', 'competitors', 'reviews',
    'content_assets', 'social_image_assets', 'campaigns', 'platform_tasks',
    'reports'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   t, t || '_tenant_fkey');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I
         FOREIGN KEY (business_id) REFERENCES public.businesses(id)
         ON DELETE CASCADE', t, t || '_business_id_fkey');
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_fill_org ON public.%I', t, t);
    EXECUTE format('DROP INDEX IF EXISTS public.idx_%s_org_business', t);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS organization_id', t);
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los UNIQUE del lado padre, ya sin nadie que los referencie
-- ─────────────────────────────────────────────────────────────────────────────
-- `business_services_business_id_id_key` NO está acá: lo agregó la 0003 para la
-- compuesta de `content_assets`, y sigue en uso. Borrarlo sería deshacer otra
-- migración desde este archivo.
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_organization_id_id_key;
ALTER TABLE public.business_locations
  DROP CONSTRAINT IF EXISTS business_locations_business_id_id_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La función de relleno, cuando ya no queda trigger que la use
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fill_organization_id_from_business();

-- `schema_migrations` no existe todavía en este punto de la historia: la crea la
-- 0008. Sin la guarda, `rollback.sh` muere con `relation "public.schema_migrations"
-- does not exist` y este .down no se puede probar nunca.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    DELETE FROM public.schema_migrations WHERE version = '0004_composite_tenant_key';
  END IF;
END
$$;
