-- 0007_explicit_function_grants.down.sql
--
-- La 0007 declaró el EXECUTE de cuatro funciones en vez de dejarlo al default.
-- Volver atrás es sacar esas concesiones explícitas.
--
-- UNA SUTILEZA QUE LA HUELLA SÍ VE: antes de la 0007 esas funciones no tenían
-- ACL propia —NULL en `proacl`, o sea "el default"—, y un REVOKE deja una ACL
-- explícita en su lugar. Para volver de verdad al estado anterior hay que
-- devolver el EXECUTE a PUBLIC, que es lo que el default dice, y sacarlo de los
-- tres roles nombrados.

-- ESTE .down NO ESTÁ PROBADO, Y HAY QUE DECIRLO
--
-- `./supabase/qa/rollback.sh 0007_explicit_function_grants` responde:
--
--     corrida vacua: 0007_explicit_function_grants no cambió el esquema, así que
--     esta prueba no puede distinguir un .down que anda de uno que no hace nada.
--
-- Y tiene razón. Desde que la réplica arranca con los default privileges de
-- Supabase —`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role`—, esas cuatro funciones YA NACEN con los tres
-- roles en su ACL. El GRANT de la 0007 no agrega nada: es defensa en profundidad
-- escrita, no un cambio.
--
-- Lo que sigue es el inverso correcto de lo que la migración declara, y queda
-- acá para el día que deje de ser un no-op. Pero no está probado, y llamarlo
-- probado sería la clase de mentira que este repositorio ya pagó.

\set ON_ERROR_STOP on

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.current_user_org_ids()',
    'public.fill_organization_id_from_business()',
    'public.handle_new_user()',
    'public.set_updated_at()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', f);
  END LOOP;
END
$$;

DELETE FROM public.schema_migrations WHERE version = '0007_explicit_function_grants';
