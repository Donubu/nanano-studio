"use client";

// Vista simplificada de los nodos cuando el canvas está muy alejado.
//
// Con zoom bajo, el detalle de un nodo (textareas, botones, conectores,
// galerías de fotos) no se lee y es lo que hace pesado mover el canvas con
// muchos nodos. Bajo LOD_ZOOM cada nodo se tapa con una tarjeta liviana
// (color del tipo, título y, si tiene, una imagen).
//
// El nodo real NO se desmonta: queda con `visibility: hidden` (el browser no
// lo pinta) para que conserve su tamaño, su estado interno y sus conectores,
// que React Flow necesita medir para dibujar las conexiones (un canvas grande
// abre directamente alejado, con fitView).

import { memo, useEffect, type ComponentType, type RefObject } from "react";
import { useStore, type NodeProps } from "@xyflow/react";
import { galleryImagesOf } from "../lib/character";
import { thumbUrl } from "../lib/thumb";

export const LOD_ZOOM = 0.3;

/** Variable CSS con el zoom actual (escalonado), en el contenedor del canvas.
 *  La tarjeta la usa para que el título se lea igual a cualquier zoom sin
 *  re-renderizar React en cada cuadro. La escribe useLodZoomVar. */
export const ZOOM_CSS_VAR = "--canvas-zoom";

/** Escribe ZOOM_CSS_VAR en `el` al cambiar el zoom (en pasos de 0,05 para
 *  no recalcular el texto de todas las tarjetas en cada cuadro). Va como
 *  componente aparte dentro de <ReactFlow> para no re-renderizar el workspace. */
export function LodZoomVar({ target }: { target: RefObject<HTMLElement | null> }) {
  useLodZoomVar(target);
  return null;
}

function useLodZoomVar(ref: RefObject<HTMLElement | null>) {
  const zoom = useStore(
    ((s: { transform: [number, number, number] }) => Math.max(0.05, Math.round(s.transform[2] * 20) / 20)) as never,
  ) as unknown as number;
  useEffect(() => {
    ref.current?.style.setProperty(ZOOM_CSS_VAR, String(zoom));
  }, [ref, zoom]);
}

// Se compara el % redondeado, el mismo que muestran los controles de zoom: con
// "30%" en pantalla todavía se ven los nodos completos.
const zoomedOutSelector = (s: { transform: [number, number, number] }) =>
  Math.round(s.transform[2] * 100) < Math.round(LOD_ZOOM * 100);

/** true si el canvas está bajo LOD_ZOOM. Solo re-renderiza al cruzar el umbral. */
export function useIsZoomedOut(): boolean {
  return useStore(zoomedOutSelector as never) as unknown as boolean;
}

interface LodStyle {
  label: string;
  border: string;
  bg: string;
}

const LOD_STYLES: Record<string, LodStyle> = {
  text: { label: "Texto", border: "border-blue-500", bg: "bg-blue-500/10" },
  "text-practicante": { label: "Practicante", border: "border-blue-500", bg: "bg-blue-500/10" },
  script: { label: "Guion", border: "border-blue-500", bg: "bg-blue-500/10" },
  "static-text": { label: "Texto", border: "border-blue-400", bg: "bg-blue-400/10" },
  image: { label: "Imagen", border: "border-purple-500", bg: "bg-purple-500/10" },
  "static-image": { label: "Imagen", border: "border-purple-400", bg: "bg-purple-400/10" },
  "static-image-group": { label: "Galería", border: "border-purple-400", bg: "bg-purple-400/10" },
  video: { label: "Video", border: "border-amber-500", bg: "bg-amber-500/10" },
  note: { label: "Nota", border: "border-amber-300", bg: "bg-amber-300/15" },
  "params-text": { label: "Parámetros", border: "border-blue-400", bg: "bg-blue-400/10" },
  "params-image": { label: "Parámetros", border: "border-purple-400", bg: "bg-purple-400/10" },
  "params-video": { label: "Parámetros", border: "border-amber-400", bg: "bg-amber-400/10" },
  "params-scene": { label: "Parámetros", border: "border-amber-400", bg: "bg-amber-400/10" },
  character: { label: "Personaje", border: "border-pink-400", bg: "bg-pink-400/10" },
  linked: { label: "Vinculado", border: "border-pink-400", bg: "bg-pink-400/10" },
  scene: { label: "Escena", border: "border-amber-500", bg: "bg-amber-500/10" },
};

const FALLBACK_STYLE: LodStyle = { label: "Nodo", border: "border-border", bg: "bg-muted/40" };

/** Imagen que representa al nodo en la vista alejada (o null). */
export function lodPreviewUrl(type: string | undefined, data: Record<string, unknown>): string | null {
  if (type === "video") return null; // el video no tiene miniatura; se ve el tipo
  if (type === "linked") {
    // Personaje vinculado: la primera etapa con imagen.
    const stages = (data.linkSnapshot as { stages?: { imageUrl?: string | null }[] } | undefined)?.stages ?? [];
    return stages.find((s) => s.imageUrl)?.imageUrl ?? null;
  }
  const first = galleryImagesOf({ type, data })[0];
  return first?.url ?? null;
}

const LodCard = memo(function LodCard({
  type,
  label,
  preview,
  selected,
  generating,
}: {
  type: string | undefined;
  label: string;
  preview: string | null;
  selected: boolean;
  generating: boolean;
}) {
  const style = (type && LOD_STYLES[type]) || FALLBACK_STYLE;
  const name = label || style.label;
  // Tamaños en px de PANTALLA (divididos por el zoom): se leen igual a 40%
  // que al zoom mínimo.
  const screenPx = (px: number) => `calc(${px}px / var(${ZOOM_CSS_VAR}, 0.3))`;
  return (
    <div className="absolute inset-0 z-10">
      <div
        className={`absolute inset-0 overflow-hidden rounded-lg border-4 bg-card ${style.border} ${style.bg} ${
          selected ? "ring-8 ring-primary/60" : ""
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl(preview, 384)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
        ) : (
          // Sin imagen: el tipo al fondo de la tarjeta, achicado para que
          // quepa entero (cqw = ancho de la tarjeta).
          <div className="absolute inset-x-0 bottom-0 flex justify-center pb-[6%] [container-type:inline-size]">
            <span
              className="whitespace-nowrap text-muted-foreground"
              style={{ fontSize: `min(${screenPx(10)}, ${Math.floor(140 / Math.max(style.label.length, 4))}cqw)` }}
            >
              {style.label}
            </span>
          </div>
        )}
        {generating && <div className="absolute right-3 top-3 h-5 w-5 animate-pulse rounded-full bg-primary" />}
      </div>
      {/* Nombre: una sola línea, sin partir palabras. Si la tarjeta es más
          angosta que el nombre, la etiqueta sobresale a los lados en vez de
          cortarse (los nodos chicos, como una galería o parámetros, quedan
          de pocos px a zoom mínimo). Solo los nombres muy largos llevan "…". */}
      <div className="pointer-events-none absolute inset-x-0 top-[4%] flex justify-center">
        <span
          title={name}
          className={`shrink-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border bg-card/95 font-semibold leading-tight text-foreground shadow-sm ${style.border}`}
          style={{
            fontSize: screenPx(12),
            padding: `${screenPx(2)} ${screenPx(6)}`,
            borderWidth: screenPx(1),
            maxWidth: screenPx(220),
          }}
        >
          {name}
        </span>
      </div>
    </div>
  );
});

/**
 * Envuelve un tipo de nodo: con zoom normal lo dibuja tal cual; alejado, lo
 * oculta (sin desmontarlo) y muestra la tarjeta encima. La estructura del
 * árbol es la misma en ambos casos, así el nodo no pierde su estado al cruzar
 * el umbral.
 */
export function withLod(Comp: ComponentType<NodeProps>) {
  const Wrapped = memo(function LodNode(props: NodeProps) {
    const zoomedOut = useIsZoomedOut();
    const data = props.data as Record<string, unknown>;
    return (
      <>
        <div style={{ display: "contents", visibility: zoomedOut ? "hidden" : undefined }}>
          <Comp {...props} />
        </div>
        {zoomedOut && (
          <LodCard
            type={props.type}
            label={String(data.label ?? "")}
            preview={lodPreviewUrl(props.type, data)}
            selected={!!props.selected}
            generating={data.status === "generating"}
          />
        )}
      </>
    );
  });
  Wrapped.displayName = `Lod(${Comp.displayName || Comp.name || "Node"})`;
  return Wrapped;
}
