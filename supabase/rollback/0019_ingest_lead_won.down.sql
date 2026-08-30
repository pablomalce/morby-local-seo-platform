-- 0019_ingest_lead_won.down.sql — la vuelta atrás de la 0019.
--
-- La 0019 sólo agrega una función. Deshacerla es tirarla, y a diferencia de la
-- 0018 no se lleva ningún dato con ella: las filas que la función escribió viven
-- en las tablas de la 0018 y siguen ahí.
--
-- LO QUE SE PIERDE, Y HAY QUE LEERLO ANTES
--
-- La ATOMICIDAD, que es lo único que esta función existía para dar.
--
-- No se nota, y por eso vale escribirlo. Sin la función, el endpoint no tiene
-- cómo hacer las cinco escrituras en una transacción: `supabase-js` manda una
-- sentencia por viaje. Reescribirlo «provisoriamente» con cinco llamadas deja
-- exactamente el agujero que la 0018 y la 0019 existen para cerrar — una caída
-- entre la cuarta y la quinta deja un cliente a medio crear cuya clave todavía no
-- está reclamada, así que el siguiente reintento se ve a sí mismo como el primero
-- y lo crea de nuevo.
--
-- O sea que el camino honesto después de correr esto es **apagar el endpoint**,
-- no dejarlo andando con un sustituto. Un `lead.won` que se pierde se reintenta;
-- un cliente duplicado hay que resolverlo a mano y con datos reales adentro.
--
-- No hay nada que respaldar: la función no guarda estado.

\set ON_ERROR_STOP on

-- La firma completa, y no `DROP FUNCTION public.ingest_lead_won` a secas: si
-- mañana existe una sobrecarga, la versión corta falla con `function name is not
-- unique` y la versión larga se lleva exactamente la que esta migración creó.
DROP FUNCTION IF EXISTS public.ingest_lead_won(
    text, text, uuid, text, text, text, text, text, text, text, jsonb, jsonb
);

-- Sin esto, check_drift.sh lee la fila y dice "no falta ninguna migración" sobre
-- una base que sí volvió atrás.
DELETE FROM public.schema_migrations WHERE version = '0019_ingest_lead_won';
