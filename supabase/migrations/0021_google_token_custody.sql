-- 0021_google_token_custody.sql — la llave de la custodia que la 0014 dejó
-- cerrada.
--
-- QUÉ ABRE
--
-- La 0014 construyó el mueble —la tabla, la referencia al Vault, la distinción
-- entre vencido y revocado— ANTES de que hubiera un token que guardar, que era
-- lo correcto. Lo que no dejó es una manera de guardarlo desde la aplicación, y
-- eso no es un olvido: hasta ayer no había credenciales de Google, así que un
-- camino de escritura habría sido código sin nada que escribir.
--
-- Hoy las hay, y faltan dos cosas que sólo se pueden resolver acá:
--
--   1. `supabase-js` sólo alcanza el esquema `public`. El secreto vive en
--      `vault`, y no hay ninguna llamada desde TypeScript que llegue hasta ahí;
--   2. crear el secreto y escribir la fila que lo referencia son DOS escrituras
--      que tienen que ser UNA. `supabase-js` manda una sentencia por viaje: la
--      caída entre las dos deja un secreto huérfano en el Vault —el token de un
--      cliente, cifrado y sin dueño— o, al revés, una fila apuntando a un
--      secreto que no existe. La segunda la ataja la foránea; la primera no la
--      ataja nadie.
--
-- Es el mismo argumento de la 0019, y por eso la forma es la misma: una función
-- es UNA sentencia desde afuera, o sea una transacción.
--
-- POR QUÉ `SECURITY INVOKER`, QUE ES LO CONTRARIO DE LA 0019
--
-- La 0019 necesita `SECURITY DEFINER` porque escribe en tablas cuyo eje de
-- tenant recién existe al terminar: no hay sesión cuya RLS pudiera aprobarla.
-- Acá no pasa eso, y se midió antes de escribirlo — sobre la réplica, el
-- 2026-09-01:
--
--   service_role  BYPASSRLS, USAGE sobre `vault`, EXECUTE sobre
--                 `vault.create_secret`, SELECT sobre `vault.decrypted_secrets`
--   authenticated ninguna de las cuatro
--
-- O sea que el único rol que va a ejecutar esto YA tiene todo lo que la función
-- necesita. `SECURITY DEFINER` no agregaría una capacidad: agregaría un
-- préstamo, y prestar los privilegios del dueño sobre el Vault es la clase de
-- cosa que se vuelve irreversible en silencio el día que alguien otorgue esta
-- función de más.
--
-- Con `SECURITY INVOKER`, otorgarla de más NO alcanza para nada: `authenticated`
-- no tiene USAGE sobre `vault`, así que la llamada muere en la primera línea que
-- lo toca. El privilegio de ejecutar y el de leer el secreto quedan separados, y
-- hacen falta los dos.
--
-- TRES ACTOS DISTINTOS, Y NO UNO CON UN PARÁMETRO
--
--   conectar   `store_integration_token`   hay una autorización NUEVA. Revoca la
--              anterior y guarda un secreto nuevo;
--   refrescar  `refresh_integration_token` la MISMA autorización, con un access
--              token nuevo. No crea fila: la crearía cada hora, y el historial de
--              revocaciones —que la 0014 conserva a propósito— pasaría a ser un
--              historial de refrescos donde nadie encuentra nada;
--   leer       `integration_token_secret`  para poder llamar a Google.
--
-- Confundir los dos primeros es el mismo error que confundir vencido con
-- revocado, una capa más arriba: `revoked_at` dejaría de significar «alguien dio
-- de baja este acceso» para significar «pasó una hora».
--
-- QUÉ GUARDA EL SECRETO, Y POR QUÉ NO ES SÓLO EL REFRESH TOKEN
--
-- Un JSON con los dos tokens. El refresh token es el que no se puede volver a
-- pedir sin el consentimiento del usuario; el access token se guarda al lado
-- porque `expires_at` ya existe en la 0014 y describe exactamente su vida útil.
-- Guardar sólo el refresh token dejaría `expires_at` sin nada honesto que decir,
-- y `integration_token_state()` —que la pantalla lee— contestaría sobre una
-- fecha inventada.
--
-- Esta función no mira ese JSON: para la base es texto opaco, y la forma se
-- valida en TypeScript, donde se prueba por mutación. La costura está puesta
-- donde la 0019 la puso.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Conectar: una autorización nueva
-- ─────────────────────────────────────────────────────────────────────────────
-- El orden no es intercambiable. El índice único de la 0014 es PARCIAL —una
-- viva por organización y proveedor— así que el INSERT antes del UPDATE choca
-- siempre. Al revés funciona, y además deja el momento intermedio del lado
-- seguro: entre la revocación y el INSERT no hay token, que se lee como «hay que
-- conectar». El orden inverso dejaría dos vivos, que es lo que el índice existe
-- para impedir.
CREATE OR REPLACE FUNCTION public.store_integration_token(
    p_organization_id uuid,
    p_provider        text,
    p_secret          text,
    p_expires_at      timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_secret_id uuid;
    v_id        uuid;
BEGIN
    -- Un secreto vacío entra al Vault sin protestar y deja una fila que dice
    -- "hay un token" sobre nada. La foránea RESTRICT de la 0014 cuida el caso en
    -- que el secreto no exista; que exista y esté vacío no lo cuida nadie.
    IF p_secret IS NULL OR btrim(p_secret) = '' THEN
        RAISE EXCEPTION 'store_integration_token: el secreto viene vacío'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.integration_tokens
       SET revoked_at = now()
     WHERE organization_id = p_organization_id
       AND provider        = p_provider
       AND revoked_at IS NULL;

    -- El nombre lleva un uuid al final porque `vault.secrets` tiene unicidad
    -- sobre `name`: un nombre determinista haría que la SEGUNDA conexión de la
    -- misma organización fallara con 23505, o sea que reconectar sería
    -- imposible justamente cuando hace falta.
    v_secret_id := vault.create_secret(
        p_secret,
        'integration_token:' || p_provider || ':' || p_organization_id::text
                             || ':' || gen_random_uuid()::text,
        'Token OAuth de ' || p_provider || ' de la organización ' || p_organization_id::text
    );

    INSERT INTO public.integration_tokens (organization_id, provider, secret_id, expires_at)
    VALUES (p_organization_id, p_provider, v_secret_id, p_expires_at)
    RETURNING id INTO v_id;

    RETURN v_id;
END
$fn$;

COMMENT ON FUNCTION public.store_integration_token(uuid, text, text, timestamptz) IS
    'Guarda una autorización NUEVA: revoca la viva, cifra el secreto en el Vault e inserta la fila, todo en una transacción.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Refrescar: la misma autorización, con otro access token
-- ─────────────────────────────────────────────────────────────────────────────
-- Devuelve `false` y no una excepción cuando no hay fila viva, porque eso NO es
-- un fallo: es que alguien revocó el acceso entre que se leyó el token y que se
-- lo quiso refrescar. La respuesta correcta es que la aplicación mande a
-- reconectar, y para eso tiene que poder distinguir «no había» de «se rompió».
CREATE OR REPLACE FUNCTION public.refresh_integration_token(
    p_organization_id uuid,
    p_provider        text,
    p_secret          text,
    p_expires_at      timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_secret_id uuid;
BEGIN
    IF p_secret IS NULL OR btrim(p_secret) = '' THEN
        RAISE EXCEPTION 'refresh_integration_token: el secreto viene vacío'
            USING ERRCODE = '22023';
    END IF;

    SELECT secret_id INTO v_secret_id
      FROM public.integration_tokens
     WHERE organization_id = p_organization_id
       AND provider        = p_provider
       AND revoked_at IS NULL
     LIMIT 1;

    IF v_secret_id IS NULL THEN
        RETURN false;
    END IF;

    PERFORM vault.update_secret(v_secret_id, p_secret);

    UPDATE public.integration_tokens
       SET expires_at = p_expires_at
     WHERE secret_id = v_secret_id;

    RETURN true;
END
$fn$;

COMMENT ON FUNCTION public.refresh_integration_token(uuid, text, text, timestamptz) IS
    'Reemplaza el secreto y la expiración de la autorización VIVA. false = no hay ninguna viva, o sea que hay que reconectar.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Leer: lo único que devuelve el secreto en claro
-- ─────────────────────────────────────────────────────────────────────────────
-- `LIMIT 1` sin ORDER BY, y acá sí alcanza: el índice único parcial de la 0014
-- garantiza que haya como mucho UNA fila viva por organización y proveedor. El
-- `ORDER BY` que `agencyToken.ts` sí necesita es porque aquella consulta NO
-- filtra por `revoked_at`: mira todas para clasificarlas.
--
-- Y `STABLE` y no `IMMUTABLE`, por el mismo motivo que `integration_token_state`
-- de la 0014: lee filas que cambian.
CREATE OR REPLACE FUNCTION public.integration_token_secret(
    p_organization_id uuid,
    p_provider        text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
    SELECT s.decrypted_secret
      FROM public.integration_tokens t
      JOIN vault.decrypted_secrets s ON s.id = t.secret_id
     WHERE t.organization_id = p_organization_id
       AND t.provider        = p_provider
       AND t.revoked_at IS NULL
     LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.integration_token_secret(uuid, text) IS
    'El secreto en claro de la autorización VIVA, o NULL. Sólo service_role: es el único objeto de public que devuelve un token.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Los privilegios, y el REVOKE que no es simétrico
-- ─────────────────────────────────────────────────────────────────────────────
-- `FROM PUBLIC` no alcanza, igual que en la 0019: los default privileges de
-- Supabase otorgan EXECUTE a `anon`, `authenticated` y `service_role` POR
-- NOMBRE, y un REVOKE a PUBLIC no toca una concesión nominal. Se revoca a los
-- tres y se otorga al único que las necesita.
--
-- Que las tres sean `SECURITY INVOKER` no vuelve decorativo este bloque. Sin él,
-- `authenticated` podría LLAMARLAS: fallarían en `vault`, sí, pero
-- `store_integration_token` alcanza a hacer su UPDATE antes de llegar ahí —o
-- sea que una sesión de navegador podría REVOCAR el token de la plataforma
-- entera con una llamada, y el error que después recibe no desharía nada. El
-- privilegio de ejecutar es lo que cierra eso, no el de leer el Vault.
REVOKE ALL ON FUNCTION public.store_integration_token(uuid, text, text, timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_integration_token(uuid, text, text, timestamptz)
    TO service_role;

REVOKE ALL ON FUNCTION public.refresh_integration_token(uuid, text, text, timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_integration_token(uuid, text, text, timestamptz)
    TO service_role;

REVOKE ALL ON FUNCTION public.integration_token_secret(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.integration_token_secret(uuid, text)
    TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0021_google_token_custody')
ON CONFLICT (version) DO NOTHING;
