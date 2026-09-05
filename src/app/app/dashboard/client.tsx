"use client";

import Link from "next/link";
import { Badge, Card, HudLabel } from "@/components/ui";
import { proximoPaso, type EstadoDelProducto } from "@/lib/product/proximoPaso";

export interface NegocioResumen {
  id: string;
  nombre: string;
  ubicaciones: number;
  servicios: number;
}

export function ProductoResumen({
  organizacion,
  negocios,
  estado,
}: {
  organizacion: string;
  negocios: NegocioResumen[];
  estado: EstadoDelProducto;
}) {
  const paso = proximoPaso(estado);

  return (
    <>
      <Card className="mt-6">
        <HudLabel>NEXT STEP</HudLabel>
        {paso ? (
          <div data-testid="proximo-paso" data-donde={paso.donde}>
            <p className="mt-3 font-display text-lg uppercase tracking-hud text-vulkan-white">
              {paso.que}
            </p>
            <p className="mt-2 text-[12px] text-metal-400">{paso.porque}</p>
            <Link
              href={paso.donde}
              className="mt-4 inline-block rounded-vulkan border border-vulkan-orange px-4 py-2 font-display text-[12px] uppercase tracking-hud text-vulkan-orange"
            >
              {paso.donde}
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-metal-300" data-testid="nada-pendiente">
            No falta nada por configurar en esta organización.
          </p>
        )}
      </Card>

      <Card className="mt-4">
        <HudLabel>{organizacion}</HudLabel>
        {negocios.length === 0 ? (
          <p className="mt-3 text-[12px] text-metal-400" data-testid="sin-negocios">
            Esta organización no tiene ningún negocio todavía.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {negocios.map((n) => (
              <div
                key={n.id}
                data-testid="negocio"
                className="flex items-center justify-between rounded-vulkan border border-metal-800 bg-metal-950 px-4 py-3"
              >
                <span className="truncate font-display text-[13px] uppercase tracking-hud">
                  {n.nombre}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-hud text-metal-500">
                  {n.ubicaciones} loc · {n.servicios} svc
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <HudLabel>WHAT THIS ORGANIZATION HAS</HudLabel>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cifra etiqueta="MAPPINGS" valor={estado.mapeos} />
          <Cifra etiqueta="REPORTS" valor={estado.reportes} />
          <Cifra etiqueta="APPROVED" valor={estado.contenidoAprobado} />
          <Cifra etiqueta="PUBLICATIONS" valor={estado.publicaciones} />
        </div>
        {estado.fuentesFallando > 0 && (
          <p className="mt-3 text-[12px] text-metal-400" data-testid="fuentes-fallando">
            <Badge variant="critical">{estado.fuentesFallando} FAILING</Badge> — el motivo de cada
            una está en /app/integrations.
          </p>
        )}
      </Card>
    </>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="rounded-vulkan border border-metal-800 bg-metal-950 px-3 py-3">
      <p className="font-mono text-[9px] uppercase tracking-hud text-metal-500">{etiqueta}</p>
      <p className="mt-1 font-display text-xl">{valor}</p>
    </div>
  );
}
