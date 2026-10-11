-- 0034_search_console_coverage.sql — lo que cubre una propiedad de Search
-- Console es de UNA organización, no sólo su texto.
--
-- QUÉ CIERRA
--
-- La 0017 promete que «un error de mapeo sea imposible en vez de improbable», y
-- lo cumple con una unicidad sobre `(provider, lower(property_ref))`. Para GA4 y
-- Business Profile alcanza: `properties/N` y `locations/N` son identificadores
-- opacos que no se contienen entre sí. Para Search Console NO alcanza, porque una
-- propiedad de Search Console no es un identificador: es un CONJUNTO DE URLs.
--
--   * una propiedad de dominio, `sc-domain:ejemplo.com`, cubre todas las URLs de
--     `ejemplo.com` y de todos sus subdominios, en http y en https;
--   * una de prefijo, `https://www.ejemplo.com/blog/`, cubre las URLs que
--     empiezan con ese prefijo.
--
-- Así que `sc-domain:ejemplo.com` en X y `https://www.ejemplo.com/` en Y son dos
-- textos distintos —la 0017 los deja vivos a los dos— y la MISMA cuenta de
-- tráfico: con el token de la agencia, que llega a las dos, el reporte de Y
-- muestra clics que también son de X.
--
-- Medido el 2026-10-11 en la revisión del PR #118 sobre una réplica propia, como
-- `service_role` (que es como escribe `property-actions.ts`): cuatro
-- organizaciones con mapeos de Search Console vivos sobre el mismo dominio
-- —`sc-domain:cliente-a.test`, `https://cliente-a.test/`,
-- `https://www.cliente-a.test/` y `http://cliente-a.test/blog/`— dieron
-- `INSERT 0 4`. Y `servirConLaAgencia()` les prestó el token de la agencia a las
-- dos primeras. `mapping.ts` sólo valida la forma y `property-actions.ts` sólo
-- traduce el 23505: nada miraba el solape.
--
-- LA REGLA
--
-- Un mapeo VIVO de Search Console no puede SOLAPARSE con el mapeo vivo de Search
-- Console de OTRA organización. Dos propiedades se solapan si existe una URL que
-- las dos cubren:
--
--   prefijo P  y prefijo Q   uno empieza con el otro. `https://a/` y
--                            `https://a/blog/` se solapan; `http://a/` y
--                            `https://a/` no (el protocolo es parte del prefijo);
--   dominio D  y prefijo P   el host de P es D o termina en `.D`. El puerto y el
--                            usuario de P no cuentan: se le sacan al host;
--   dominio D  y dominio E   D = E, o uno termina en `.` y el otro. Un dominio
--                            cubre sus subdominios, y la propiedad de un
--                            subdominio es un subconjunto de la del dominio.
--
-- Todo en minúsculas, como la 0017 y por lo mismo: rechazar de más es una
-- molestia de onboarding, compartir es una fuga entre clientes.
--
-- SOBRE LA FORMA CANÓNICA, NO SOBRE EL TEXTO
--
-- La primera versión de esta regla comparaba el texto en minúsculas, y medido
-- el 2026-10-11 en la segunda revisión del #118 (30 casos sobre una réplica
-- propia) daba «no se solapan» en alias que el CHECK de la 0017 deja entrar:
-- `https://a.test/` contra `https://a.test:443/`, `https://u@a.test/`,
-- `https://a.test./` o `https://a.test/%62log/`; `sc-domain:a.test` contra
-- `https://a.test?q/`, `https://a.test#f/`, `https://a.test\x/` o
-- `https://a@b@c.test/`; y un dominio internacional escrito en Unicode contra
-- su punycode. Tres de esos pares entraron vivos en dos organizaciones como
-- `service_role`, con el trigger puesto.
--
-- Ahora las dos propiedades se llevan antes a su FORMA CANÓNICA
-- (`search_console_canonical`), con las reglas del parser de URL de los
-- navegadores (WHATWG) para http y https:
--
--   * la autoridad termina en el primero de `/ ? # \`; el usuario es todo hasta
--     la ÚLTIMA `@`; el puerto vacío o el del esquema (`:443` en https, `:80` en
--     http, con o sin ceros adelante) no se escribe; los puntos finales del host
--     se sacan (también en `sc-domain:`);
--   * la ruta usa `/` por `\`. Si tiene un segmento `.` o `..` —también escrito
--     `%2e`— se reduce a `/`: un `..` sube por encima de cualquier recorte. Si
--     no, se corta en el primer `?`, `#` o `%`. Cortar un prefijo lo AGRANDA (un
--     prefijo más corto cubre más), así que nunca esconde un solape: a lo sumo
--     inventa uno, que es el lado de rechazar de más;
--   * el host tiene que ser un nombre en ASCII —letras, dígitos, guiones y
--     puntos, sin etiquetas vacías— y su última etiqueta no puede ser un número
--     (`127.1`, `0x7f.1` y `2130706433` son la misma dirección IP para un
--     navegador). Si no lo es, NO HAY forma canónica: un dominio internacional
--     va en punycode (`xn--…`), que es como lo devuelve Search Console.
--
-- Una propiedad viva sin forma canónica se rechaza con 23514 (`check_violation`):
-- no se puede saber con qué se solapa, y no se adivina. Para el solape, una sin
-- forma canónica se solapa con todo.
--
-- Lo IDÉNTICO no lo mira esta regla: es de la 0017, que lo rechaza con 23505.
-- Separarlo es a propósito: si esta regla también lo rechazara, el bloque 43 de
-- la suite —que mide el índice de la 0017— pasaría por ESTE trigger el día que
-- alguien tocara el índice.
--
-- Viola la regla → SQLSTATE 23P01 (`exclusion_violation`): es, en lo que
-- significa, una restricción de exclusión, que PostgreSQL no puede escribir como
-- índice porque «se solapa» acá no es un operador indexable.
--
-- POR QUÉ UN TRIGGER AFTER, CON CANDADO, Y NO UN `if` EN EL SERVIDOR
--
-- La 0017 lo dice de su unicidad y vale igual: «comprobar que nadie más tenga
-- esto» es una consulta seguida de un INSERT, y dos onboardings concurrentes
-- pasan los dos por el `if`. Acá la comprobación es una consulta —no hay índice
-- que la haga—, así que el trigger toma un candado transaccional
-- (`pg_advisory_xact_lock`) sobre «los mapeos de Search Console» antes de mirar:
-- el segundo onboarding espera a que el primero termine, y entonces lo ve.
--
-- Eso sólo es cierto en READ COMMITTED, donde cada consulta de la función toma
-- una foto nueva DESPUÉS del candado. En REPEATABLE READ o SERIALIZABLE la foto
-- es la del principio de la transacción y el segundo no vería al primero aunque
-- haya esperado. Así que fuera de READ COMMITTED el trigger NO decide: rechaza
-- con 45007. PostgREST y el cliente de Supabase escriben en READ COMMITTED.
--
-- AFTER y no BEFORE, para que corra DESPUÉS de lo que la 0017 ya rechaza: una
-- forma no canónica muere en el CHECK (23514) y un duplicado en el índice
-- (23505), con su propio código, antes de llegar acá. Con BEFORE, una referencia
-- mal escrita como `http` «se solapaba» con `https://bob.example/` y moría con
-- el código equivocado.
--
-- SECURITY DEFINER, y por qué: la comprobación tiene que ver los mapeos de TODAS
-- las organizaciones, y con SECURITY INVOKER vería los que la RLS le deja ver a
-- quien escribe. Hoy escribe `service_role`, que tiene BYPASSRLS, pero una regla
-- de aislamiento no puede depender de que el próximo escritor también lo tenga.
-- El dueño es `postgres`, que en la imagen de Supabase y en hosted tiene
-- BYPASSRLS (medido en la réplica: `rolbypassrls = t`). Y si un día no lo tiene,
-- el trigger no lo supone: lo pregunta y rechaza con 45007, porque mirar con la
-- RLS puesta daría «nadie más lo tiene» sin haber mirado.
--
-- LO QUE HAY HOY, Y LA GUARDA
--
-- Antes de crear el trigger, la migración cuenta los pares de mapeos vivos de
-- Search Console de organizaciones distintas que ya se solapan. Si hay alguno,
-- NO se aplica: el trigger no mira lo que ya está, y aplicar sobre un solape
-- vivo dejaría la promesa escrita y la fuga puesta. Hosted, medido el 2026-10-11
-- (`tpqiltnskfeycnybczgz`, sólo SELECT de conteos): un solo mapeo vivo de Search
-- Console, así que cero pares.
--
-- Y LA GUARDA TAMBIÉN CUENTA las propiedades vivas de Search Console sin forma
-- canónica: el trigger no mira lo que ya está, así que una viva sin forma
-- canónica tampoco deja aplicar. Hosted, medido el 2026-10-11: ver la medición
-- del ejecutable en `~/vulkan-backups/growth-os/2026-10-11-pre-0034/exec/`.
--
-- EL REMAPEO, EN UNA TRANSACCIÓN
--
-- `property-actions.ts` remapeaba en dos llamadas: desmapear el vivo de la
-- organización y después insertar el nuevo. Medido en la misma revisión: si el
-- INSERT chocaba —con esta regla, cada remapeo que se solapara con otra
-- organización—, la organización quedaba SIN su mapeo vivo anterior, que era
-- válido. `remap_integration_property()` hace las dos cosas en una
-- transacción: un 23505, 23P01, 23514 o 45007 revierte también el desmapeo.
-- SECURITY INVOKER: corre con los privilegios de quien la llama
-- (`service_role`, que ya tiene UPDATE e INSERT sobre la tabla); DEFINER le
-- daría a cualquiera con EXECUTE la escritura del mapeo. EXECUTE, sólo
-- `service_role`.
--
-- QUÉ NO HACE
--
--   * No mira GA4 ni Business Profile: sus identificadores no se contienen.
--   * No sabe de la lista de sufijos públicos: `sc-domain:co.uk` solaparía con
--     todo `.co.uk`, y está bien que lo haga.
--   * No traduce Unicode a punycode: lo rechaza (ver arriba).
--   * El historial (filas con `unmapped_at`) no bloquea nada, como en la 0017.

\set ON_ERROR_STOP on

BEGIN;

-- El CREATE TRIGGER toma un lock sobre `integration_properties`. Si algo lo
-- tiene tomado, mejor fallar a los cinco segundos.
SET LOCAL lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La forma canónica de una propiedad, qué cubre, y cuándo dos se solapan
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_console_canonical(ref text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    r         text := lower(ref);
    esquema   text;
    resto     text;
    autoridad text;
    ruta      text;
    host      text;
    puerto    text;
BEGIN
    IF starts_with(r, 'sc-domain:') THEN
        host := rtrim(substr(r, 11), '.');
    ELSE
        esquema := split_part(r, '://', 1);
        IF esquema NOT IN ('http', 'https') THEN
            RETURN NULL;
        END IF;
        resto     := substr(r, length(esquema) + 4);
        -- La autoridad termina en el primero de / ? # \ (esquema especial).
        autoridad := substring(resto FROM '^[^/?#\\]*');
        ruta      := replace(substr(resto, length(autoridad) + 1), '\', '/');
        -- El usuario es todo hasta la ÚLTIMA @.
        host      := regexp_replace(autoridad, '^.*@', '');
        puerto    := coalesce(substring(host FROM ':([0-9]*)$'), '');
        host      := rtrim(regexp_replace(host, ':[0-9]*$', ''), '.');
        IF puerto <> '' THEN
            puerto := coalesce(nullif(ltrim(puerto, '0'), ''), '0');
        END IF;
        IF (esquema = 'https' AND puerto = '443') OR (esquema = 'http' AND puerto = '80') THEN
            puerto := '';
        END IF;
        -- Sin ruta (la autoridad terminó en ? o #), o con un segmento . o ..:
        -- la raíz. Si no, la ruta hasta el primer ? # %. Ver el encabezado.
        IF ruta !~ '^/' OR ruta ~ '(^|/)(\.|%2e)(\.|%2e)?(/|[?#]|$)' THEN
            ruta := '/';
        ELSE
            ruta := substring(ruta FROM '^[^?#%]*');
        END IF;
    END IF;

    -- Un nombre en ASCII, sin etiquetas vacías, que no sea una dirección IP.
    IF host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)*$' OR host ~ '(^|\.)(0x[0-9a-f]*|[0-9]+)$' THEN
        RETURN NULL;
    END IF;

    IF esquema IS NULL THEN
        RETURN 'sc-domain:' || host;
    END IF;
    RETURN esquema || '://' || host || CASE WHEN puerto <> '' THEN ':' || puerto ELSE '' END || ruta;
END
$$;

COMMENT ON FUNCTION public.search_console_canonical(text) IS
    'La forma canonica de una propiedad de Search Console (parser WHATWG para http/https: autoridad hasta / ? # \, usuario hasta la ultima @, sin puerto por defecto ni puntos finales; ruta hasta ? # %, o / si tiene un segmento . o ..), o NULL si el host no es un nombre ASCII o es una IP. Ver la 0034.';

CREATE OR REPLACE FUNCTION public.search_console_overlap(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    x  text := public.search_console_canonical(a);
    y  text := public.search_console_canonical(b);
    dx boolean;
    dy boolean;
    hx text;
    hy text;
BEGIN
    -- Sin forma canónica no se sabe qué cubre: se solapa con todo.
    IF x IS NULL OR y IS NULL THEN
        RETURN true;
    END IF;
    dx := starts_with(x, 'sc-domain:');
    dy := starts_with(y, 'sc-domain:');

    -- Dos prefijos: uno contiene al otro. Los dos terminan en `/` o en un
    -- recorte, así que `https://a.test/` no es prefijo de `https://a.testing/`.
    IF NOT dx AND NOT dy THEN
        RETURN starts_with(x, y) OR starts_with(y, x);
    END IF;

    -- El host: lo que sigue a `sc-domain:`, o lo que va entre `://` y la
    -- primera `/` de la forma canónica, sin el puerto que haya quedado.
    hx := CASE WHEN dx THEN substr(x, 11)
               ELSE regexp_replace(split_part(split_part(x, '://', 2), '/', 1), ':[0-9]+$', '') END;
    hy := CASE WHEN dy THEN substr(y, 11)
               ELSE regexp_replace(split_part(split_part(y, '://', 2), '/', 1), ':[0-9]+$', '') END;

    -- Un dominio cubre un host si es él o un subdominio suyo. Con `right()` y no
    -- con LIKE: un `_` en un host sería un comodín.
    IF dx AND dy THEN
        RETURN hx = hy
            OR right(hx, length(hy) + 1) = '.' || hy
            OR right(hy, length(hx) + 1) = '.' || hx;
    END IF;
    IF dx THEN
        RETURN hy = hx OR right(hy, length(hx) + 1) = '.' || hx;
    END IF;
    RETURN hx = hy OR right(hx, length(hy) + 1) = '.' || hy;
END
$$;

COMMENT ON FUNCTION public.search_console_overlap(text, text) IS
    'Si dos propiedades de Search Console cubren alguna URL en comun, sobre su forma canonica (search_console_canonical): prefijo/prefijo si uno empieza con el otro; dominio/prefijo si el host es el dominio o un subdominio; dominio/dominio si son iguales o uno es subdominio del otro. Sin forma canonica, true. Ver la 0034.';

-- Puras, sin datos: no hay nada que esconder, pero tampoco ningún rol de la API
-- las necesita. Por nombre además de PUBLIC, por los default privileges.
REVOKE ALL ON FUNCTION public.search_console_canonical(text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_console_overlap(text, text)
    FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La guarda: no se aplica sobre un solape que ya existe, ni sobre una
--    propiedad viva sin forma canónica
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    sin_forma int;
    pares     int;
BEGIN
    SELECT count(*) INTO sin_forma
      FROM public.integration_properties
     WHERE provider = 'search_console'
       AND unmapped_at IS NULL
       AND public.search_console_canonical(property_ref) IS NULL;

    IF sin_forma > 0 THEN
        RAISE EXCEPTION
            '0034: % mapeo(s) vivo(s) de Search Console sin forma canonica',
            sin_forma
            USING ERRCODE = '23514',
                  HINT = 'desmapear (unmapped_at) o reescribir en ASCII (punycode) antes de aplicar: el trigger no mira lo que ya existe.';
    END IF;

    SELECT count(*) INTO pares
      FROM public.integration_properties p
      JOIN public.integration_properties q
        ON q.provider = 'search_console'
       AND q.unmapped_at IS NULL
       AND q.organization_id > p.organization_id
       AND public.search_console_overlap(p.property_ref, q.property_ref)
     WHERE p.provider = 'search_console'
       AND p.unmapped_at IS NULL;

    IF pares > 0 THEN
        RAISE EXCEPTION
            '0034: % par(es) de mapeos vivos de Search Console de organizaciones distintas se solapan',
            pares
            USING ERRCODE = '23P01',
                  HINT = 'desmapear uno de cada par (unmapped_at) antes de aplicar: el trigger no mira lo que ya existe.';
    END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.integration_properties_search_console_coverage()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER a propósito: tiene que ver los mapeos de todas las organizaciones.
-- Ver el encabezado.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    choca uuid;
BEGIN
    IF NEW.provider IS DISTINCT FROM 'search_console' OR NEW.unmapped_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- Sin forma canónica no se sabe qué cubre. Ver el encabezado.
    IF public.search_console_canonical(NEW.property_ref) IS NULL THEN
        RAISE EXCEPTION
            'la propiedad de Search Console % no tiene forma canonica',
            NEW.property_ref
            USING ERRCODE = '23514',
                  HINT = 'el host tiene que ser un nombre en ASCII (un dominio internacional va en punycode, xn--...) y no una direccion IP.';
    END IF;

    -- Lo que esta comprobación necesita para valer, preguntado y no supuesto.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION
            'el solape de Search Console sólo se puede comprobar en READ COMMITTED, y esta transacción es %',
            current_setting('transaction_isolation')
            USING ERRCODE = '45007',
                  HINT = 'mapear en una transacción READ COMMITTED: en otra, la consulta no ve el mapeo de un onboarding concurrente.';
    END IF;
    IF NOT coalesce((SELECT rolbypassrls OR rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user), false) THEN
        RAISE EXCEPTION
            'el solape de Search Console se comprueba como %, que no ve los mapeos de todas las organizaciones',
            current_user
            USING ERRCODE = '45007',
                  HINT = 'el dueño de integration_properties_search_console_coverage() tiene que tener BYPASSRLS.';
    END IF;

    -- Un onboarding a la vez: el segundo espera, y su consulta (una foto nueva,
    -- READ COMMITTED) ve lo que el primero dejó.
    PERFORM pg_advisory_xact_lock(hashtextextended('public.integration_properties/search_console', 0));

    SELECT p.organization_id INTO choca
      FROM public.integration_properties p
     WHERE p.provider = 'search_console'
       AND p.unmapped_at IS NULL
       AND p.id <> NEW.id
       AND p.organization_id <> NEW.organization_id
       -- Lo idéntico es de la 0017 (23505). Ver el encabezado.
       AND lower(p.property_ref) <> lower(NEW.property_ref)
       AND public.search_console_overlap(p.property_ref, NEW.property_ref)
     LIMIT 1;

    IF FOUND THEN
        -- Sin la property ni la organización de la otra fila: quien lee este
        -- error es un operador mapeando a un cliente, y lo que le sirve saber es
        -- que choca, no los datos de otro.
        RAISE EXCEPTION
            'la propiedad de Search Console % se solapa con la de otra organización',
            NEW.property_ref
            USING ERRCODE = '23P01',
                  HINT = 'un dominio cubre sus subdominios y sus prefijos de URL: desmapear la otra primero, o mapear una que no se solape.';
    END IF;

    RETURN NULL;
END
$$;

-- Un trigger no necesita EXECUTE para dispararse.
REVOKE ALL ON FUNCTION public.integration_properties_search_console_coverage()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.integration_properties_search_console_coverage() IS
    'Un mapeo vivo de Search Console tiene forma canonica (23514) y no se solapa con el vivo de otra organizacion (23P01). Lo identico es de la 0017 (23505). Fuera de READ COMMITTED, o sin ver todas las filas, rechaza (45007). Ver la 0034.';

DROP TRIGGER IF EXISTS trg_integration_properties_search_console_coverage ON public.integration_properties;
CREATE TRIGGER trg_integration_properties_search_console_coverage
    AFTER INSERT OR UPDATE OF organization_id, provider, property_ref, unmapped_at
    ON public.integration_properties
    FOR EACH ROW
    EXECUTE FUNCTION public.integration_properties_search_console_coverage();

-- Como los guards de la 0027 y la 0033: un trigger normal no dispara con
-- `session_replication_role = 'replica'`.
ALTER TABLE public.integration_properties
    ENABLE ALWAYS TRIGGER trg_integration_properties_search_console_coverage;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El remapeo, en una transacción
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remap_integration_property(
    p_organization_id uuid,
    p_provider        text,
    p_property_ref    text
)
RETURNS void
LANGUAGE plpgsql
-- INVOKER a propósito: ver el encabezado.
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Primero se desmapea: el índice `integration_properties_one_live_per_provider`
    -- rechazaría el INSERT con el anterior vivo. Si el INSERT choca, esta
    -- función entera se revierte, y el desmapeo con ella.
    UPDATE public.integration_properties
       SET unmapped_at = now()
     WHERE organization_id = p_organization_id
       AND provider = p_provider
       AND unmapped_at IS NULL;

    INSERT INTO public.integration_properties (organization_id, provider, property_ref)
    VALUES (p_organization_id, p_provider, p_property_ref);
END
$$;

COMMENT ON FUNCTION public.remap_integration_property(uuid, text, text) IS
    'Desmapea el vivo de (organizacion, superficie) e inserta el nuevo en UNA transaccion: si el INSERT choca (23505, 23P01, 23514, 45007) se revierte tambien el desmapeo. SECURITY INVOKER; EXECUTE solo service_role. Ver la 0034.';

REVOKE ALL ON FUNCTION public.remap_integration_property(uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remap_integration_property(uuid, text, text) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0034_search_console_coverage')
ON CONFLICT (version) DO NOTHING;

COMMIT;
