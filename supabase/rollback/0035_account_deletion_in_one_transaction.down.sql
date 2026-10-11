-- Revierte la 0035.
--
-- Sacar la función devuelve la base al estado anterior EXACTO: la baja de cuenta
-- vuelve a ser la secuencia de pedidos de PostgREST de `faade08`, con los cuatro
-- defectos que la 0035 cierra.
--
-- Antes de correrlo, el código desplegado tiene que ser uno que NO llame a
-- `delete_account_organizations`: con la función afuera, `deleteMyAccount`
-- contesta `no-se-pudo-verificar` (PGRST202) y no borra nada. Falla cerrada,
-- pero nadie puede darse de baja hasta volver el código atrás.
--
-- No hay datos que revertir: lo que la función borró —organizaciones,
-- membresías, sellos soltados— lo pidió una persona dándose de baja, no la
-- migración. No vuelve con esto, y no tiene que volver.

\set ON_ERROR_STOP on

DROP FUNCTION IF EXISTS public.delete_account_organizations(uuid);

DELETE FROM public.schema_migrations WHERE version = '0035_account_deletion_in_one_transaction';
