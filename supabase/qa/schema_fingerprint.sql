-- Huella determinística del esquema, para comparar dos bases objeto por objeto.
--
-- Para qué, y es distinto del caso de Lead Engine. Acá el esquema SÍ vive en el
-- repositorio desde el 0001. Lo que no existe es nada que lo aplique: medido,
-- ni `.github/workflows/ci.yml`, ni `vercel.json`, ni `package.json` tienen un
-- paso que corra las migraciones contra el proyecto hosted. El job de CI las
-- aplica a un Postgres descartable para poder correr las aserciones, y eso es
-- todo. Las migraciones llegan a `tpqiltnskfeycnybczgz` porque alguien las
-- aplica a mano.
--
-- Un proceso así deriva, y la deriva no avisa. Este archivo es cómo se ve:
--
--   local:   ./supabase/qa/replica.sh
--            docker exec growthos-replica psql -U postgres -d growthos \
--                -tAf /tmp/schema_fingerprint.sql
--   hosted:  pegar el contenido en el SQL editor del proyecto
--
-- Las dos salidas se comparan. Cada línea es objeto más hash de lo que lo
-- define, así que una diferencia señala qué objeto difiere en vez de decir sólo
-- que algo difiere. Los conteos van primero para que un faltante salte antes
-- que un desvío de definición.
--
-- Fuera de la huella a propósito: nombres de secuencias internas de identidad,
-- OIDs y todo lo que cambia entre dos bases sin que el esquema cambie.

-- pgcrypto y uuid-ossp viven en el esquema `extensions` del proyecto hosted y en
-- `public` de la réplica local, así que sus 46 funciones aparecían como deriva
-- del esquema cuando no lo son. Lo que le pertenece a una extensión no es de
-- este repositorio y no se compara.
CREATE OR REPLACE FUNCTION pg_temp.es_de_extension(p_oid oid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.objid = p_oid AND d.deptype = 'e');
$$;

SELECT 'conteo tablas: '      || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL
SELECT 'conteo policies: '    || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
UNION ALL
SELECT 'conteo triggers: '    || count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND NOT t.tgisinternal
UNION ALL
SELECT 'conteo funciones: '   || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT pg_temp.es_de_extension(p.oid)
UNION ALL
SELECT 'conteo indices: '     || count(*) FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT 'conteo constraints: ' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'

UNION ALL
SELECT 'columna ' || c.relname || '.' || a.attname || ' ' ||
       md5(format_type(a.atttypid, a.atttypmod) || coalesce(pg_get_expr(ad.adbin, ad.adrelid),'') || a.attnotnull::text)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped

UNION ALL
SELECT 'constraint ' || cl.relname || '.' || co.conname || ' ' || md5(pg_get_constraintdef(co.oid))
  FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid
  JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public'

UNION ALL
SELECT 'indice ' || indexname || ' ' || md5(indexdef) FROM pg_indexes WHERE schemaname='public'

UNION ALL
SELECT 'policy ' || c.relname || '.' || p.polname || ' ' ||
       md5(p.polcmd::text || p.polpermissive::text ||
           coalesce(pg_get_expr(p.polqual, p.polrelid),'') ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') ||
           coalesce((SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r WHERE r <> 0), 'public'))
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'

UNION ALL
-- Sólo el cuerpo y los atributos que importan. pg_get_functiondef() difiere
-- entre 16 y 17 en detalles de formato que no son el esquema.
SELECT 'funcion ' || p.proname || ' ' ||
       md5(p.prosrc || p.prosecdef::text || p.provolatile::text || coalesce(array_to_string(p.proconfig,','),''))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND NOT pg_temp.es_de_extension(p.oid)

UNION ALL
SELECT 'trigger ' || c.relname || '.' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth') AND NOT t.tgisinternal

UNION ALL
SELECT 'rls ' || c.relname || ' enable=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'

UNION ALL
-- Un conteo por categoría, y no es redundante con las líneas por objeto: una
-- categoría SIN filas desaparece del resultado en vez de decir cero, así que
-- comparando sólo las que aparecen, una clase entera de objeto puede faltar de
-- un lado sin que nada lo diga. Fue el caso: la réplica no tenía ningún grant a
-- los roles de Supabase y hosted tenía 282, y la comparación no lo reportó
-- porque del lado local no había categoría `grant` que comparar.
SELECT 'conteo grants: ' || count(*) FROM information_schema.role_table_grants
 WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')

UNION ALL
SELECT 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')

UNION ALL
-- El rol de QA no es parte del esquema: supabase/qa/app_role.sql le da EXECUTE
-- sobre todo `public` después de las migraciones, y si contara acá la huella
-- local nunca podría coincidir con la de una base donde ese rol no existe.
SELECT 'execute ' || p.proname || ' ' ||
       coalesce((SELECT string_agg(e, ' ') FROM unnest(p.proacl::text[]) e
                  WHERE e NOT LIKE 'leadengine\_qa=%'), 'default')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND NOT pg_temp.es_de_extension(p.oid)

ORDER BY 1;
