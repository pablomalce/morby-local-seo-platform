-- Lo que el .down de la 0029 tiene que NEGARSE a borrar.
--
-- La lee `supabase/qa/rollback.sh 0029_board`: la siembra sobre una COPIA de la
-- base ya migrada y exige que `supabase/rollback/0029_board.down.sql` se niegue
-- sin permiso y con el permiso en PGOPTIONS, y que revierta con el permiso dado
-- con SET en la sesión. Ver el encabezado de ese bloque en `rollback.sh`.
--
-- UNA tarjeta alcanza: la negativa del .down es «mientras exista una». Datos de
-- prueba, con «QA» en el nombre, en una base descartable.
--
-- permiso: vulkan.perder_el_tablero

INSERT INTO auth.users (id, email)
VALUES ('d0290000-0029-4029-8029-0000000000d1', 'qa-down-0029@example.test');

-- `handle_new_user` le dio a la persona su organización y la membresía de dueña.
INSERT INTO public.board_cards (organization_id, product, objective, assignee_id)
SELECT organization_id, 'growth_os', 'QA tarjeta que el .down tiene que negarse a borrar', user_id
  FROM public.org_members
 WHERE user_id = 'd0290000-0029-4029-8029-0000000000d1' AND role = 'owner';

DO $$
BEGIN
    IF (SELECT count(*) FROM public.board_cards) <> 1 THEN
        RAISE EXCEPTION 'la siembra del .down de la 0029 no dejó UNA tarjeta: la prueba sería vacua';
    END IF;
END
$$;
