"use client";

// Guía de marca del cliente traída de practicante (por slug). Muestra el
// snapshot guardado y permite re-sincronizar. La IA de producción lo usa como
// contexto al crear desde texto/referencia; nunca consulta practicante en vivo.

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateLocal } from "@/lib/utils";
import type { BrandGuide } from "@/lib/production/brand-guide";

interface GuideState {
  slug: string | null;
  guide: BrandGuide | null;
  synced_at: string | null;
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border/50">
          {t}
        </span>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export default function ClientBrandGuideSection({ clientId }: { clientId: number }) {
  const [state, setState] = useState<GuideState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [assetsMsg, setAssetsMsg] = useState<string | null>(null);

  const syncAssets = async () => {
    setAssetsBusy(true);
    setAssetsMsg(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-assets`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssetsMsg(body?.error || `Error ${res.status}`);
        return;
      }
      setAssetsMsg(
        body.logosAdded || body.colorsAdded
          ? `Kit de marca actualizado: ${body.logosAdded} logo(s) y ${body.colorsAdded} color(es) nuevos.`
          : "El kit de marca ya estaba al día.",
      );
    } catch (e) {
      setAssetsMsg(`Error de red: ${(e as Error).message}`);
    } finally {
      setAssetsBusy(false);
    }
  };

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/brand-guide`);
    if (res.ok) setState(await res.json());
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-guide`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error ${res.status}`);
        return;
      }
      setState(body);
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const g = state?.guide;
  return (
    <div className="bg-card rounded-xl border border-border/50 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Guía de marca
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Se trae del brandbook en Practicante
            {state?.slug ? (
              <>
                {" "}con el slug <span className="font-mono">{state.slug}</span>
              </>
            ) : null}
            . La IA de producción la usa para escribir en la voz de la marca.
            {state?.synced_at ? ` Última sincronización: ${formatDateLocal(state.synced_at)}` : ""}
            {state?.synced_at && g?.sync?.agente ? ` por ${g.sync.agente}` : ""}
            {state?.synced_at && g?.sync?.costo_usd != null ? ` (USD ${g.sync.costo_usd.toFixed(2)})` : ""}
            {state?.synced_at ? "." : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Cada sincronización lee brandbook, estrategia y métricas: tarda de 30 s a 2 min y cuesta ~USD 0,5–1 en
            Practicante.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={sync}
          disabled={syncing || !state?.slug}
          className="gap-1 shrink-0"
          title={state?.slug ? undefined : "Agrega el slug del cliente (Clientes → Editar) para sincronizar"}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {g ? "Re-sincronizar" : "Sincronizar desde Practicante"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={syncAssets}
          disabled={assetsBusy || !state?.slug}
          className="gap-1 shrink-0"
          title="Trae los logos oficiales del kit de marca de Practicante al brand kit (sin costo)"
        >
          {assetsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Traer logos
        </Button>
      </div>

      {!state?.slug && (
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene slug. Agrégalo en Clientes → Editar, con el mismo identificador que usa en Practicante.
        </p>
      )}
      {syncing && (
        <p className="text-xs text-muted-foreground">
          El agente de la marca está revisando el brandbook, la estrategia y las métricas; puede tardar hasta 2
          minutos.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {assetsMsg && <p className="text-xs text-muted-foreground">{assetsMsg}</p>}

      {g && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {g.voz.tono && (
            <Row label="Tono">
              <p>{g.voz.tono}</p>
              <Chips items={g.voz.personalidad} />
            </Row>
          )}
          {g.voz.tratamiento && (
            <Row label="Tratamiento">
              <p>{g.voz.tratamiento}</p>
            </Row>
          )}
          {g.voz.palabras_usar.length > 0 && (
            <Row label="Palabras a usar">
              <Chips items={g.voz.palabras_usar} />
            </Row>
          )}
          {g.voz.palabras_evitar.length > 0 && (
            <Row label="Palabras a evitar">
              <Chips items={g.voz.palabras_evitar} />
            </Row>
          )}
          {g.voz.ejemplos_titulares.length > 0 && (
            <Row label="Ejemplos de titulares">
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {g.voz.ejemplos_titulares.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Row>
          )}
          {g.voz.ejemplos_cta.length > 0 && (
            <Row label="Ejemplos de CTA">
              <Chips items={g.voz.ejemplos_cta} />
            </Row>
          )}
          {g.visual.colores.length > 0 && (
            <Row label="Colores">
              <div className="flex flex-wrap gap-2">
                {g.visual.colores.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs" title={c.uso}>
                    <span className="h-4 w-4 rounded border border-border/50" style={{ background: c.hex }} />
                    {c.nombre || c.hex}
                  </span>
                ))}
              </div>
            </Row>
          )}
          {g.visual.tipografias.length > 0 && (
            <Row label="Tipografías">
              <p className="text-xs">{g.visual.tipografias.map((t) => `${t.nombre}${t.uso ? ` (${t.uso})` : ""}`).join(" · ")}</p>
            </Row>
          )}
          {(g.visual.logo.ancho_min_px || g.visual.logo.area_seguridad || g.visual.logo.usos_prohibidos.length > 0) && (
            <Row label="Logo">
              <p className="text-xs">
                {g.visual.logo.ancho_min_px ? `Ancho mínimo ${g.visual.logo.ancho_min_px}px. ` : ""}
                {g.visual.logo.area_seguridad}
              </p>
              {g.visual.logo.usos_prohibidos.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  {g.visual.logo.usos_prohibidos.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </Row>
          )}
          {g.visual.estilo_fotografico && (
            <Row label="Estilo fotográfico">
              <p className="text-xs">{g.visual.estilo_fotografico}</p>
            </Row>
          )}
          {g.estrategia?.posicionamiento && (
            <Row label="Posicionamiento">
              <p className="text-xs">{g.estrategia.posicionamiento}</p>
            </Row>
          )}
          {g.estrategia?.publico_objetivo && (
            <Row label="Público">
              <p className="text-xs">{g.estrategia.publico_objetivo}</p>
            </Row>
          )}
          {g.estrategia?.propuesta_valor && (
            <Row label="Propuesta de valor">
              <p className="text-xs">{g.estrategia.propuesta_valor}</p>
            </Row>
          )}
          {(g.estrategia?.mensajes_clave.length ?? 0) > 0 && (
            <Row label="Mensajes clave">
              <Chips items={g.estrategia!.mensajes_clave} />
            </Row>
          )}
          {(g.estrategia?.productos.length ?? 0) > 0 && (
            <Row label="Productos">
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {g.estrategia!.productos.map((p, i) => (
                  <li key={i}>
                    {p.nombre}
                    {p.descripcion ? ` — ${p.descripcion}` : ""}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {(g.estrategia?.campanas_vigentes.length ?? 0) > 0 && (
            <Row label="Campañas vigentes">
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {g.estrategia!.campanas_vigentes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Row>
          )}
          {(g.desempeno?.aprendizajes.length ?? 0) > 0 && (
            <div className="md:col-span-2">
              <Row label={`Aprendizajes de métricas${g.desempeno!.periodo ? ` (${g.desempeno!.periodo})` : ""}`}>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {g.desempeno!.aprendizajes.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Row>
            </div>
          )}
          {[
            { label: "Mensajes que rinden", items: g.desempeno?.mensajes_destacados ?? [] },
            { label: "CTA que rinden", items: g.desempeno?.ctas_destacados ?? [] },
            { label: "Mensajes a evitar", items: g.desempeno?.mensajes_a_evitar ?? [] },
          ]
            .filter((b) => b.items.length > 0)
            .map((b) => (
              <Row key={b.label} label={b.label}>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {b.items.map((e, i) => (
                    <li key={i}>
                      {e.texto}
                      {e.resultado && <span className="text-muted-foreground"> — {e.resultado}</span>}
                    </li>
                  ))}
                </ul>
              </Row>
            ))}
          {(g.desempeno?.formatos_destacados.length ?? 0) > 0 && (
            <Row label="Formatos que rinden">
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {g.desempeno!.formatos_destacados.map((f, i) => (
                  <li key={i}>
                    {f.formato}
                    {f.canal ? ` · ${f.canal}` : ""}
                    {f.resultado && <span className="text-muted-foreground"> — {f.resultado}</span>}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {(g.desempeno?.piezas?.length ?? 0) > 0 && (
            <div className="md:col-span-2">
              <Row label="Piezas reales y sus métricas">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {g.desempeno!.piezas!.map((p, i) => (
                    <div key={i} className="rounded-lg border border-border/50 overflow-hidden bg-muted/30 text-[11px]">
                      {p.imagen ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imagen} alt="" className="w-full aspect-square object-cover bg-muted" />
                      ) : (
                        <div className="w-full aspect-square flex items-center justify-center text-muted-foreground">
                          Sin imagen
                        </div>
                      )}
                      <div className="p-2 space-y-1">
                        <span
                          className={
                            p.rendimiento === "alto"
                              ? "inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300"
                              : "inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300"
                          }
                        >
                          {p.rendimiento === "alto" ? "Rinde" : "No rinde"}
                        </span>
                        {p.texto && <p className="line-clamp-2">{p.texto}</p>}
                        <p className="text-muted-foreground">{[p.formato, p.canal].filter(Boolean).join(" · ")}</p>
                        {p.resultado && <p className="text-muted-foreground line-clamp-3">{p.resultado}</p>}
                        {p.descripcion_visual && (
                          <p className="text-muted-foreground/80 line-clamp-3" title={p.descripcion_visual}>
                            {p.descripcion_visual}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Row>
            </div>
          )}
          {(g.desempeno?.estilos_visuales.length ?? 0) > 0 && (
            <Row label="Estilos que rinden">
              <Chips items={g.desempeno!.estilos_visuales} />
            </Row>
          )}
          {((g.legales?.textos_obligatorios.length ?? 0) > 0 || (g.legales?.restricciones.length ?? 0) > 0) && (
            <div className="md:col-span-2">
              <Row label="Legales">
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {g.legales!.textos_obligatorios.map((t, i) => (
                    <li key={`o${i}`}>{t}</li>
                  ))}
                  {g.legales!.restricciones.map((t, i) => (
                    <li key={`r${i}`} className="text-amber-300/90">
                      {t}
                    </li>
                  ))}
                </ul>
              </Row>
            </div>
          )}
          {g.reglas.length > 0 && (
            <div className="md:col-span-2">
              <Row label="Reglas">
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {g.reglas.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </Row>
            </div>
          )}
          {g.fuentes.length > 0 && (
            <p className="md:col-span-2 text-[10px] text-muted-foreground">Fuentes: {g.fuentes.join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
