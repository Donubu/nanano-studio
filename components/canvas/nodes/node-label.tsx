"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useCanvasContext } from "../canvas-context";

interface NodeLabelProps {
  value: string;
  placeholder: string;
  onChange: (label: string) => void;
  // Clases extra de color para variantes (ej. nota ámbar).
  className?: string;
}

// Título del nodo. En reposo es texto plano (clickear/arrastrar el nodo desde
// el título ya no entra a editar por accidente); doble click entra a modo
// edición con todo el texto seleccionado. Enter o blur confirman; Escape
// cancela SOLO la edición (revierte el valor) sin deseleccionar el nodo ni
// cerrar el canvas — por eso el listener de Escape va en CAPTURE de window,
// antes que el handler de Escape del workspace y el cierre de la conversación.
export const NodeLabel = memo(function NodeLabel({ value, placeholder, onChange, className = "" }: NodeLabelProps) {
  const { canEdit } = useCanvasContext();
  const [editing, setEditing] = useState(false);
  // Draft local mientras se edita: evita que el round-trip por React Flow /
  // collab atrase el valor controlado y resetee el caret (mismo patrón que
  // los textareas de los nodos estáticos).
  const [draft, setDraft] = useState(value);
  const originalRef = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const startEdit = () => {
    if (!canEdit || editing) return;
    originalRef.current = value;
    setDraft(value);
    setEditing(true);
  };
  const startEditRef = useRef(startEdit);
  useEffect(() => {
    startEditRef.current = startEdit;
  });

  // El doble click se maneja con listener NATIVO en el wrapper: corre en el
  // target antes de que el evento burbujee, así el stopPropagation evita el
  // zoom por doble click de React Flow (d3-zoom escucha en un ancestro) —
  // y como eso también impide que llegue al root de React, la edición se
  // inicia aquí mismo en vez de con onDoubleClick.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onDblClick = (e: MouseEvent) => {
      e.stopPropagation();
      startEditRef.current();
    };
    el.addEventListener("dblclick", onDblClick);
    return () => el.removeEventListener("dblclick", onDblClick);
  }, []);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onChangeRef.current(originalRef.current);
      setEditing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing]);

  // Callback ref: enfoca y selecciona todo el texto en el mismo commit en que
  // el input se monta (un requestAnimationFrame llegaba tarde y el foco
  // quedaba en el elemento previo, p. ej. un edge).
  const focusOnMount = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el && document.activeElement !== el) {
      el.focus();
      el.select();
    }
  };

  const base = "text-xs font-medium w-full min-w-0 bg-transparent border-none outline-none truncate";

  return (
    <span ref={wrapperRef} className="flex-1 min-w-0 flex items-center">
      {editing ? (
        <input
          ref={focusOnMount}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onChangeRef.current(e.target.value);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className={`${base} placeholder:text-muted-foreground/50 ${className} nodrag`}
        />
      ) : (
        <span
          title={canEdit ? "Doble click para renombrar" : undefined}
          className={`${base} ${value ? "" : "text-muted-foreground/50"} ${className} select-none`}
        >
          {value || placeholder}
        </span>
      )}
    </span>
  );
});
