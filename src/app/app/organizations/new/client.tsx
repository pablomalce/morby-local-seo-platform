"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, HudLabel } from "@/components/ui";

/**
 * QUÉ IMPIDE ESTA PANTALLA
 *
 * Que dar de alta un cliente sea una llamada de consola.
 *
 * POR QUÉ PIDE MÁS QUE EL NOMBRE
 *
 * Con el nombre solo alcanza para crear la organización, y no para nada de lo que
 * viene después. `website` es contra lo que corre PageSpeed; `industry` y
 * `valueProposition` son el insumo del análisis estratégico y de las palabras
 * clave. Pedirlos acá, una vez, evita descubrir que faltan cuando alguien pide el
 * primer reporte y el reporte compara contra nada.
 *
 * Son OPCIONALES a propósito: un alta que se traba porque falta la propuesta de
 * valor manda a inventarla, y una propuesta de valor inventada es peor que
 * ninguna. Esta pantalla los pide; no los exige.
 */
export function AltaDeCliente() {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `onSubmit` y no `action={crear}`: esto no es una server action —es un
  // componente cliente que llama a `fetch`— y un `action` no se dispara en
  // jsdom, o sea que el cableado quedaría sin poder probarse.
  async function alEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await crear(new FormData(e.currentTarget));
  }

  async function crear(formData: FormData) {
    setEnviando(true);
    setError(null);

    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        website: String(formData.get("website") ?? ""),
        industry: String(formData.get("industry") ?? ""),
        valueProposition: String(formData.get("valueProposition") ?? ""),
        brandTone: String(formData.get("brandTone") ?? ""),
        locale: String(formData.get("locale") ?? "en"),
      }),
    });

    const cuerpo = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      motivo?: string;
      organizationId?: string;
    };

    if (res.status === 207) {
      // El caso incómodo, dicho entero: la organización EXISTE. Ocultarlo mandaría
      // a crearla otra vez, y la segunda tendría slug `cliente-1`.
      setEnviando(false);
      setError(
        `La organización se creó (${cuerpo.organizationId}) y su negocio no. No la vuelvas a crear: elegila en el selector y agregale el negocio.`
      );
      return;
    }

    if (!res.ok) {
      setEnviando(false);
      setError(`No se pudo dar de alta el cliente (${res.status}).`);
      return;
    }

    // La organización nueva ya es una membresía activa, así que el selector la
    // ofrece. NO se cambia sola a ella: cambiar de cliente sin pedirlo es cómo se
    // termina escribiendo en el tenant equivocado.
    router.push("/app/dashboard");
    router.refresh();
  }

  return (
    <Card className="mt-6">
      <HudLabel>NEW CLIENT</HudLabel>
      <p className="mt-3 text-[12px] text-metal-400">
        Cada cliente es su propia organización: es lo que mantiene sus properties de Google, sus
        reportes y su contenido separados de los de otro cliente.
      </p>

      <form onSubmit={alEnviar} className="mt-4 space-y-3" data-testid="alta-de-cliente">
        <Campo nombre="name" etiqueta="NOMBRE DEL CLIENTE" requerido />
        <Campo nombre="website" etiqueta="SITIO WEB" ayuda="Contra esto corre PageSpeed" />
        <Campo nombre="industry" etiqueta="RUBRO" ayuda="Insumo del análisis estratégico" />
        <Campo
          nombre="valueProposition"
          etiqueta="PROPUESTA DE VALOR"
          ayuda="Qué lo hace distinto. De acá salen las palabras clave"
        />
        <Campo nombre="brandTone" etiqueta="TONO DE MARCA" ayuda="Cómo habla, para el contenido" />

        <label className="block">
          <span className="font-mono text-[9px] uppercase tracking-hud text-metal-500">IDIOMA</span>
          <select
            name="locale"
            defaultValue="es"
            className="mt-1 w-full rounded-vulkan border border-metal-700 bg-metal-950 px-3 py-2 text-[13px] text-vulkan-white"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="sv">Svenska</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={enviando}
          data-testid="crear-cliente"
          className="w-full rounded-vulkan bg-vulkan-orange px-4 py-2 font-display text-[12px] uppercase tracking-hud text-vulkan-black disabled:opacity-50"
        >
          {enviando ? "CREANDO..." : "CREAR CLIENTE"}
        </button>

        {error && (
          <p
            data-testid="error-alta"
            className="rounded-vulkan border border-red-900/60 bg-red-950/30 p-3 text-[12px] text-red-200"
          >
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}

function Campo({
  nombre,
  etiqueta,
  ayuda,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-hud text-metal-500">
        {etiqueta}
        {!requerido && <span className="text-metal-600"> · opcional</span>}
      </span>
      <input
        name={nombre}
        required={requerido}
        className="mt-1 w-full rounded-vulkan border border-metal-700 bg-metal-950 px-3 py-2 text-[13px] text-vulkan-white"
      />
      {ayuda && <span className="mt-1 block text-[11px] text-metal-500">{ayuda}</span>}
    </label>
  );
}
