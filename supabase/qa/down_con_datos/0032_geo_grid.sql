-- Lo que el .down de la 0032 tiene que NEGARSE a borrar.
--
-- La lee `supabase/qa/rollback.sh 0032_geo_grid`: la siembra sobre una COPIA de
-- la base ya migrada y exige que `supabase/rollback/0032_geo_grid.down.sql` se
-- niegue sin permiso, con el permiso en PGOPTIONS y con un permiso que no es
-- 'si', y que revierta con el permiso dado con SET en la sesión, sacando su
-- registro y consumiendo el permiso. Y la corre OTRA VEZ, sobre otra copia sin
-- corridas, adentro de una transacción que no confirma hasta que el .down está
-- esperando un lock. Por eso este archivo tiene que poder correr entero dentro
-- de una transacción abierta, sobre una base sin nada sembrado: crea su propia
-- persona y su propio negocio.
--
-- UNA corrida alcanza —la negativa del .down es «mientras exista una»—, con UNA
-- observación para que el DROP de la hija también tenga algo, y la aprobación de
-- gasto que la paga, sin la cual la corrida no se puede escribir (decisión 13 de
-- la 0032). Datos de prueba, con «QA» en el nombre, en una base descartable.
--
-- permiso: vulkan.perder_las_grillas

INSERT INTO auth.users (id, email)
VALUES ('d0320000-0032-4032-8032-0000000000d1', 'qa-down-0032@example.test');

-- `handle_new_user` le dio a la persona su organización y la membresía de dueña.
INSERT INTO public.businesses (id, organization_id, name)
SELECT 'd0320000-0032-4032-8032-0000000000b1', organization_id, 'QA negocio de la grilla'
  FROM public.org_members
 WHERE user_id = 'd0320000-0032-4032-8032-0000000000d1' AND role = 'owner';

INSERT INTO public.geo_grid_spend_approvals (id, organization_id, max_runs, approved_by, expires_at)
SELECT 'd0320000-0032-4032-8032-0000000000a1', organization_id, 3, 'QA .down de la 0032', now() + interval '3 hours'
  FROM public.org_members
 WHERE user_id = 'd0320000-0032-4032-8032-0000000000d1' AND role = 'owner';

INSERT INTO public.geo_grid_runs (id, organization_id, business_id, keyword, target_place_id,
                                  center_lat, center_lng, radius_m, step_m, n_points,
                                  approval_id, approval_max_runs, approval_slot, created_by)
SELECT 'd0320000-0032-4032-8032-0000000000c1', organization_id, 'd0320000-0032-4032-8032-0000000000b1',
       'QA corrida que el .down tiene que negarse a borrar', 'ChIJqaDown0032aaaaaaaaaa',
       59.3293, 18.0686, 1000, 1500, 1,
       'd0320000-0032-4032-8032-0000000000a1', 3, 1, user_id
  FROM public.org_members
 WHERE user_id = 'd0320000-0032-4032-8032-0000000000d1' AND role = 'owner';

-- Una grilla de UN punto: su única celda es el centro.
INSERT INTO public.geo_grid_observations (organization_id, run_id, run_n_points, run_center_lat,
                                          run_center_lng, run_step_m, grid_row, grid_col,
                                          lat, lng, observed_at, outcome, position)
SELECT organization_id, id, n_points, center_lat, center_lng, step_m, 0, 0,
       center_lat, center_lng, now(), 'position', 3
  FROM public.geo_grid_runs
 WHERE id = 'd0320000-0032-4032-8032-0000000000c1';

DO $$
BEGIN
    IF (SELECT count(*) FROM public.geo_grid_spend_approvals) <> 1
       OR (SELECT count(*) FROM public.geo_grid_runs) <> 1
       OR (SELECT count(*) FROM public.geo_grid_observations) <> 1 THEN
        RAISE EXCEPTION 'la siembra del .down de la 0032 no dejó UNA aprobación, UNA corrida y UNA observación: la prueba sería vacua';
    END IF;
END
$$;
