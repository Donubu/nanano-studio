"use client";

// Lista "Conectar con…" que se abre al hacer clic en un conector: los
// conectores de otros nodos con los que se puede conectar (buscable, los más
// cercanos primero) y, abajo, crear un nodo nuevo ya conectado.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Search } from "lucide-react";
import { thumbUrl } from "./lib/thumb";

export interface ConnectPickerItem {
  key: string;
  nodeLabel: string;
  typeLabel: string;
  handleLabel: string;
  thumb?: string | null;
}

export interface ConnectPickerCreateOption {
  key: string;
  label: string;
}

export function ConnectPicker({
  x,
  y,
  title,
  direction,
  items,
  createOptions,
  onPick,
  onCreate,
  onHover,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  /** "out" = desde una salida (elige a quién entregar); "in" = desde una entrada. */
  direction: "out" | "in";
  items: ConnectPickerItem[];
  createOptions: ConnectPickerCreateOption[];
  onPick: (key: string) => void;
  onCreate: (key: string) => void;
  onHover?: (key: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.nodeLabel} ${i.typeLabel} ${i.handleLabel}`.toLowerCase().includes(q));
  }, [items, query]);

  // Dentro de la ventana (la lista mide como máximo ~420 px de alto y 320 de ancho).
  const left = typeof window !== "undefined" ? Math.min(x, window.innerWidth - 330) : x;
  const top = typeof window !== "undefined" ? Math.min(y, window.innerHeight - 440) : y;
  const Arrow = direction === "out" ? ArrowRight : ArrowLeft;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-[320px] bg-popover border border-border rounded-lg shadow-xl flex flex-col max-h-[420px]"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && filtered[active]) onPick(filtered[active].key);
        }}
      >
        <div className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground uppercase tracking-wider">{title}</div>
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-input px-2 h-8">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder="Buscar nodo…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </div>
        <div className="overflow-y-auto px-1 pb-1 min-h-0" onMouseLeave={() => onHover?.(null)}>
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {items.length === 0 ? "No hay nodos en el canvas que se puedan conectar aquí." : "Sin resultados."}
            </p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.key}
              onClick={() => onPick(item.key)}
              onMouseEnter={() => { setActive(i); onHover?.(item.key); }}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors ${i === active ? "bg-accent" : ""}`}
            >
              {item.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura vía /_next/image (thumbUrl)
                <img src={thumbUrl(item.thumb, 128)} alt="" className="h-7 w-7 rounded object-cover shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded bg-muted shrink-0" />
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm truncate">{item.nodeLabel}</span>
                <span className="text-[11px] text-muted-foreground truncate">{item.typeLabel}</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] font-medium text-primary shrink-0">
                <Arrow className="h-3 w-3" />
                {item.handleLabel}
              </span>
            </button>
          ))}
          {createOptions.length > 0 && (
            <>
              <div className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground uppercase tracking-wider border-t border-border/60 mt-1">
                Crear nodo nuevo
              </div>
              <div className="flex flex-wrap gap-1 px-1 pb-1">
                {createOptions.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => onCreate(o.key)}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border hover:bg-accent transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
