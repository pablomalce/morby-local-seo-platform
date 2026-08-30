-- 0018_expand_lead_ingest.sql — dónde aterriza un lead ganado, y por qué un
-- reintento no puede duplicarlo.
--
-- QUÉ CIERRA, Y QUÉ NO
--
-- `vulkan-lead-engine/docs/CONTRATO_GROWTH_OS.md` tiene una sección titulada «lo
-- que no tiene dónde aterrizar en Growth OS hoy», y dice de sí misma que hay que
-- borrarla cláusula por cláusula a medida que cada fila deja de ser cierta. Esta
-- migración borra las tres:
--
--   business.slug          no existía columna en ninguna de las diecisiete
--   contact.*              no existía tabla
--   location.postal_code   no existía columna
--
-- No cierra la ingesta: cierra el lugar donde la ingesta escribe. El endpoint es
-- el frente siguiente y esta migración es su precondición — al revés, la ingesta
-- tendría que tirar tres campos del payload y nadie se enteraría hasta que
-- alguien preguntara por el teléfono de un cliente.
--
-- EL PAYLOAD APUNTA AL VOCABULARIO CANÓNICO, NO AL ESQUEMA DE HOY
--
-- Y eso es deliberado del lado del productor: el canónico es adonde van los dos
-- productos. La consecuencia es que la ingesta es una TRADUCCIÓN, y que las
-- columnas de acá se escriben contra `~/vulkan-os/ESQUEMA_CANONICO.md` §6.1 y
-- §6.2 y no contra lo que el payload trae. `contacts.city` y `contacts.country`
-- entran aunque el payload de hoy no los mande, porque §6.2 los mapea desde
-- `lead.city` y `lead.country`; dejarlos afuera obligaría a una segunda
-- migración el día que el productor los agregue.
--
-- LA IDEMPOTENCIA ES UNA RESTRICCIÓN, NO UN `if`
--
-- Mismo argumento que la 0016 hace sobre publicar, y acá el precio es peor.
-- «Ya procesamos este lead» es una consulta seguida de un INSERT, y dos entregas
-- concurrentes —un reintento del productor, un `Won → Lost → Won`, una cola que
-- se reproduce después de un redeploy— pasan las dos por el `if`. Lo que queda
-- del otro lado no es un post repetido: es una Organization duplicada, con su
-- Business y sus Locations colgando, y un operador decidiendo cuál de las dos es
-- el cliente.
--
-- La única forma de que «no duplica» sea cierta es que la base rechace el
-- segundo. Por eso `ingest_events` existe y por eso su unicidad es GLOBAL.
--
-- Y EL ORDEN DE ESCRITURA SALE DE ESA RESTRICCIÓN, NO AL REVÉS
--
-- El primer diseño reclamaba la clave ANTES de crear nada, con
-- `organization_id` nullable — parecía lo obvio: reclamar primero, trabajar
-- después. **La suite lo rechazó**, y tenía razón: el bloque 12 dice que
-- `organization_id` y `business_id` no admiten NULL en ninguna tabla de
-- `public`, sin excepciones, y una fila sin tenant es el defecto 1.
--
-- La salida no era aflojar el bloque. Es que el endpoint trabaje en UNA
-- transacción y reclame la clave AL FINAL:
--
--     BEGIN
--       adoptar o crear la Organization, el Business y las Locations
--       INSERT INTO ingest_events (source_system, idempotency_key, ..., organization_id)
--     COMMIT
--
-- Una segunda entrega de la misma clave hace todo el trabajo otra vez y **pierde
-- en el INSERT final con `23505`**; su transacción entera vuelve atrás y se
-- lleva la organización especulativa con ella. La promesa «un reintento no
-- duplica» la sostiene la base, no el orden en que el código tuvo suerte.
--
-- Cuesta trabajo desperdiciado en un reintento, que es raro, a cambio de que la
-- garantía sea una restricción. Es el mismo canje que la 0016 hizo con publicar.
--
-- POR QUÉ `ingest_events` NO LLEVA RLS
--
-- Tiene tenant, pero no es una tabla del cliente: es de la PLATAFORMA, como
-- `schema_migrations`. No la lee ninguna sesión de navegador, no la publica
-- PostgREST para nadie, y su único escritor es el endpoint con `service_role`.
--
-- Su aislamiento no se resuelve con una policy sino sacándole el privilegio a
-- todo lo demás, que es lo que hace la sección 5 — y lo que los bloques 48 y 49
-- de la suite miden, uno por cada rol que podría alcanzarla.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `businesses.slug` — el slug por tenant
-- ─────────────────────────────────────────────────────────────────────────────
-- Nullable, y NO es pereza de expand/contract: la tabla ya tiene filas y un
-- `NOT NULL DEFAULT ''` las dejaría a todas con el mismo slug vacío, o sea con
-- la unicidad de abajo violada desde el minuto uno. Nullable es además lo que el
-- canónico permite mientras el slug no se haya asignado.
ALTER TABLE public.businesses
    ADD COLUMN IF NOT EXISTS slug text;

COMMENT ON COLUMN public.businesses.slug IS
    'Slug del negocio dentro de su organización. NULL = todavía no asignado. Lo propone el productor y lo resuelve el receptor: la unicidad es de este lado.';

-- La forma, y es el mismo argumento que la 0017 hace con `property_ref`: una
-- unicidad sobre texto libre se saltea escribiendo lo mismo de otra manera.
--
-- El dominio es el del canónico, copiado del contrato, y exige tres caracteres
-- como mínimo: empieza y termina en alfanumérico, con guiones sólo en el medio.
-- `growthOsSlug()` del Lead Engine ya produce exactamente esto, con
-- `lead-<id>` de reserva cuando un nombre no deja nada usable — «Hudvård
-- Göteborg AB» es la entrada ordinaria de once países de prospección, no el caso
-- raro.
--
-- NOT VALID a propósito: las filas que ya están tienen `slug` NULL y un CHECK no
-- se evalúa sobre NULL, así que validar no encontraría nada — pero declararlo
-- NOT VALID deja escrito que esta migración no revisó el pasado, sólo el futuro.
-- Se valida enseguida, abajo, para que la restricción quede entera y no a medias.
ALTER TABLE public.businesses
    DROP CONSTRAINT IF EXISTS businesses_slug_shape_check;
ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_slug_shape_check
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9]([a-z0-9-]{1,60}[a-z0-9])$') NOT VALID;
ALTER TABLE public.businesses
    VALIDATE CONSTRAINT businesses_slug_shape_check;

-- POR TENANT, no global, y ésa es la diferencia con `organizations.slug`.
--
-- `organizations.slug` es `text not null unique` sin alcance: dos agencias cuyos
-- clientes se llaman los dos «Hudvård Göteborg» chocan en toda la plataforma. Eso
-- ya está así y no se toca acá. Lo que sí se puede hacer bien desde el principio
-- es que el slug de un NEGOCIO sólo tenga que ser único adentro de su
-- organización, que es lo que el canónico pide y lo que evita que el cliente de
-- una agencia le bloquee un nombre al de otra.
--
-- `lower()` por lo mismo que la 0017: sin normalizar, la unicidad se saltea con
-- la tecla de bloqueo de mayúsculas. El CHECK de arriba ya prohíbe mayúsculas, y
-- las dos cosas juntas son deliberadas: el CHECK dice qué se acepta, el índice
-- dice qué colisiona, y si mañana el CHECK se afloja el índice sigue de pie.
--
-- Parcial, `WHERE slug IS NOT NULL`, porque muchos negocios sin slug asignado no
-- son una colisión.
CREATE UNIQUE INDEX IF NOT EXISTS businesses_one_slug_per_organization
    ON public.businesses (organization_id, lower(slug))
    WHERE slug IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `business_locations.postal_code`
-- ─────────────────────────────────────────────────────────────────────────────
-- `NOT NULL DEFAULT ''` como sus ocho hermanas de texto, y no nullable: el
-- contrato dice que los campos opcionales viajan como `""` y nunca como `null`,
-- y la razón está escrita allá — casi todos son opcionales en un Lead, así que
-- el caso común, no el borde, es el que un `null` haría rebotar.
--
-- El Lead Engine raspa Google Places por el negocio y no por su calle, así que
-- `address_line`, `region` y `postal_code` no tienen origen del otro lado y
-- viajan vacíos. Vacío es la manera honesta de decir «no se sabe» a una columna
-- `NOT NULL DEFAULT ''`.
ALTER TABLE public.business_locations
    ADD COLUMN IF NOT EXISTS postal_code text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.business_locations.postal_code IS
    'Código postal. Vacío = no se sabe: el Lead Engine no lo tiene, y vacío es como el contrato dice «desconocido».';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `contacts` — la entidad que existe ANTES de ser cliente
-- ─────────────────────────────────────────────────────────────────────────────
-- Es la tabla que el canónico §6.2 mapea desde `lead.*`. El eje de tenant es
-- `organization_id` y NO cuelga del negocio, que es lo que el canónico pide; la
-- diferencia con §6.3 está anotada en `business_id`, abajo.
CREATE TABLE IF NOT EXISTS public.contacts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- El eje, NOT NULL desde el primer día: la tabla nace vacía, así que no hay
    -- ninguna fila sin tenant que tolerar mientras tanto.
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- NOT NULL, y acá Growth OS se aparta del canónico A PROPÓSITO.
    --
    -- §6.3 dice que `contacts.business_id` es nullable porque un Contact existe
    -- ANTES de ser cliente. Eso es cierto del Lead Engine, que es donde vive el
    -- pipeline comercial —New, Contacted, Replied, Proposal Sent— y donde un
    -- contacto pasa semanas sin negocio.
    --
    -- Growth OS no tiene esa fase. Acá un contacto llega por `lead.won`, o sea
    -- justo cuando el negocio se está creando: la única entrada que existe hoy
    -- trae las dos cosas juntas. Una columna nullable para un caso que este
    -- producto no tiene es una columna que hay que comprobar en cada consulta
    -- para siempre.
    --
    -- Y el bloque 12 de la suite lo dice sin excepciones: `organization_id` y
    -- `business_id` no pueden admitir NULL en ninguna tabla de `public`. Se
    -- podría haberle agregado una lista de excepciones a ese bloque; sería
    -- aflojar una guarda que atrapa filas sin tenant de verdad, para un caso
    -- hipotético. **La dirección barata del error es ésta:** el día que Growth OS
    -- tenga contactos pre-cliente, relajar un NOT NULL es una migración de una
    -- línea; descubrir filas sin tenant en producción no.
    --
    -- La FK es COMPUESTA contra `(organization_id, id)` como todo hijo de
    -- `businesses` en este esquema: así una fila no puede reclamar un tenant que
    -- su padre no tiene.
    business_id     uuid NOT NULL,

    display_name    text NOT NULL DEFAULT '',
    email           text NOT NULL DEFAULT '',
    phone           text NOT NULL DEFAULT '',
    website         text NOT NULL DEFAULT '',
    city            text NOT NULL DEFAULT '',

    -- `char(2)` no: la columna hermana de `business_locations` es `text NOT NULL
    -- DEFAULT ''`, y una de las dos formas tiene que ganar para que traducir de
    -- contacto a location no sea una conversión. Gana la que ya está aplicada en
    -- producción. El productor manda ISO 3166-1 alpha-2 en mayúsculas —viene de
    -- su tabla de once países— y el CHECK de abajo lo exige acá.
    country         text NOT NULL DEFAULT '',

    -- De dónde salió el contacto. `gdpr_source` del otro lado, y el nombre
    -- importa: es lo que hay que poder contestar cuando alguien reclama.
    source          text NOT NULL DEFAULT '',

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT contacts_tenant_fkey
        FOREIGN KEY (organization_id, business_id)
        REFERENCES public.businesses (organization_id, id) ON DELETE CASCADE,

    -- Vacío o dos mayúsculas, nada en el medio. Vacío es «no se sabe»; `se`,
    -- `SWE` y `Sweden` son tres maneras de escribir mal lo mismo, y con la
    -- columna libre las tres entran y ninguna junta con la otra.
    --
    -- ELSE implícito por la forma del regex: `^$` cubre el vacío. Se escribe
    -- así y no con un `IN (...)` de once códigos porque la lista de países de
    -- prospección se amplía del lado del productor y una lista acá quedaría
    -- vieja sin que nada lo dijera.
    CONSTRAINT contacts_country_shape_check
        CHECK (country ~ '^([A-Z]{2})?$')
);

COMMENT ON TABLE public.contacts IS
    'Los contactos de un cliente. El eje de tenant es organization_id y no cuelga del negocio; business_id es NOT NULL acá, a diferencia del canónico §6.3, porque Growth OS no tiene fase pre-cliente.';
COMMENT ON COLUMN public.contacts.business_id IS
    'NOT NULL, a diferencia del canónico §6.3: Growth OS no tiene fase pre-cliente. La FK es compuesta, así que una fila no puede reclamar un tenant que su negocio no tiene.';
COMMENT ON COLUMN public.contacts.source IS
    'De dónde salió el contacto (gdpr_source del Lead Engine). Es lo que hay que poder contestar cuando alguien reclama.';

CREATE INDEX IF NOT EXISTS contacts_org_idx
    ON public.contacts (organization_id);
CREATE INDEX IF NOT EXISTS contacts_org_business_idx
    ON public.contacts (organization_id, business_id);

-- Un correo identifica a UNA persona dentro de una organización. Parcial, porque
-- el vacío es «no se sabe» y muchos desconocidos no son la misma persona — que
-- es exactamente el error que una unicidad total cometería sobre una columna
-- `NOT NULL DEFAULT ''`.
--
-- `lower()`: los buzones no distinguen mayúsculas para el dominio y en la
-- práctica tampoco para el buzón. Rechazar un duplicado es una molestia de
-- onboarding; aceptar dos filas para la misma persona es un doble contacto en un
-- reclamo de GDPR.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_email_per_organization
    ON public.contacts (organization_id, lower(email))
    WHERE email <> '';

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON public.contacts;
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: una permisiva que da acceso y una RESTRICTIVE que fija el eje. Las dos,
-- por lo mismo que la 0014, la 0016 y la 0017: una RESTRICTIVE sola no deja ver
-- NADA —se combinan con AND sobre lo que alguna permisiva permitió— y una
-- permisiva sola se anula agregando otra más laxa.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
-- FORCE además de ENABLE: sin él el dueño queda exento por serlo, que es el
-- defecto 6 de la suite. El canónico lista `contacts` entre las tablas que una
-- mutación encontró SIN force; acá nace con él.
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_rw_member" ON public.contacts;
CREATE POLICY "contacts_rw_member" ON public.contacts
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "contacts_tenant_axis" ON public.contacts;
CREATE POLICY "contacts_tenant_axis" ON public.contacts
    AS RESTRICTIVE
    FOR ALL
    USING (organization_id IN (SELECT public.current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- Los privilegios no se heredan: se declaran. Una tabla nueva en `public` NACE
-- con los siete para los tres roles por los default privileges de Supabase.
REVOKE ALL ON public.contacts FROM anon, authenticated, service_role;

-- `authenticated` sí escribe acá, a diferencia de la 0014 y la 0017, y la
-- diferencia importa: un contacto NO es una credencial ni un puntero a datos
-- ajenos. Una fila mal escrita ensucia el CRM de quien la escribió y no le abre
-- la puerta a nada de otro cliente — la RLS alcanza porque la fuga sería sobre
-- la FILA, y la fila es suya. Es el caso que la 0017 NO era.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `ingest_events` — la restricción que hace que un reintento no duplique
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ingest_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Qué sistema mandó esto. Va aparte de la clave y no concatenado adentro:
    -- el día que haya un segundo productor, una clave que colisione entre dos
    -- sistemas distintos sería un evento descartado por parecerse a otro.
    source_system    text NOT NULL,

    -- `vulkan-lead-engine:lead:<uuid>`. Depende del id del lead y de nada más —
    -- ni de la hora, ni del intento— y ésa es toda la razón de que el receptor
    -- se pueda reproducir. Una clave con una marca de tiempo adentro se ve
    -- idéntica en un test que pasa y hace que cada reintento sea una
    -- Organization duplicada en producción.
    idempotency_key  text NOT NULL,

    event            text NOT NULL,

    -- A qué organización terminó apuntando, NOT NULL — y eso obliga a un orden
    -- de escritura concreto del lado del endpoint. Ver el encabezado.
    organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    received_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ingest_events_source_system_check
        CHECK (source_system <> ''),
    CONSTRAINT ingest_events_idempotency_key_check
        CHECK (idempotency_key <> ''),
    CONSTRAINT ingest_events_event_check
        CHECK (event <> '')
);

COMMENT ON TABLE public.ingest_events IS
    'Las claves de idempotencia ya vistas. La unicidad de abajo es lo que hace que un reintento no duplique un cliente; sin ella la promesa es un `if` y dos entregas concurrentes pasan las dos.';
COMMENT ON COLUMN public.ingest_events.organization_id IS
    'A qué organización terminó apuntando. NOT NULL: la clave se reclama DESPUÉS de crear la organización y en la MISMA transacción, así que un reintento se lleva la organización especulativa al hacer rollback.';

-- LA RESTRICCIÓN. No parcial, no por tenant: total.
--
-- Por tenant no puede ser —en el momento del INSERT no hay tenant— y parcial
-- tampoco: una clave «desactivada» que deje pasar la segunda entrega es
-- exactamente lo que esto existe para impedir. Un evento visto es visto para
-- siempre; ése es el precio y es el correcto.
CREATE UNIQUE INDEX IF NOT EXISTS ingest_events_source_key
    ON public.ingest_events (source_system, idempotency_key);

CREATE INDEX IF NOT EXISTS ingest_events_org_idx
    ON public.ingest_events (organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El privilegio de `ingest_events`, que es todo su aislamiento
-- ─────────────────────────────────────────────────────────────────────────────
-- No lleva RLS y por eso el privilegio tiene que hacer todo el trabajo.
--
-- Una policy sobre una tabla sin eje de tenant no podría decir nada útil: no hay
-- columna con la que filtrar en el momento que importa. Lo que sí se puede es
-- que ninguna sesión de navegador la alcance — ni para leer, que es tanto como
-- publicar qué clientes entraron y cuándo, ni para escribir, que sería reclamar
-- la clave de otro y hacer que su lead ganado se descarte como duplicado.
--
-- Es el mismo trato que `schema_migrations` recibió en la 0009, y por el mismo
-- motivo: es una tabla de la plataforma, no del cliente.
REVOKE ALL ON public.ingest_events FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ingest_events TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('0018_expand_lead_ingest')
ON CONFLICT (version) DO NOTHING;
