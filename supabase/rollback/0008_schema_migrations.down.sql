-- 0008_schema_migrations.down.sql
--
-- La 0008 creó el registro de migraciones aplicadas. Volver atrás lo tira, y con
-- él la única forma que tiene la base de decir qué migraciones tiene puestas.
--
-- LO QUE ESO SIGNIFICA, y es peor de lo que parece: `check_drift.sh` lee esa
-- tabla para decidir qué falta aplicar. Sin ella, el job de deriva no puede
-- contestar su primera pregunta, y la única forma de saber en qué estado está una
-- base vuelve a ser deducirlo comparando catálogos — que es exactamente el
-- problema que la 0008 vino a cerrar, y cómo se descubrió que la 0006 estaba
-- mergeada y sin aplicar.
--
-- No hay nada que respaldar: la tabla se reconstruye reaplicando la 0008, que
-- rellena las siete anteriores. Lo que se pierde son las fechas de aplicación
-- posteriores.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS public.schema_migrations;
