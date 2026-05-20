"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Pencil, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GOOGLE_FONTS,
  GoogleFont,
  ensureGoogleFontLoaded,
  fontFamilyCss,
  findGoogleFont,
  primaryFamilyName,
} from "@/lib/production/google-fonts";

interface Props {
  value: string;
  onChange: (cssFontFamily: string) => void;
}

// Combobox for the brand kit's font picker. Users can search through the
// curated Google Fonts list or toggle a "Custom" mode that exposes a free-text
// input for stacks not on the list (system fonts, self-hosted, etc.).
export function FontPicker({ value, onChange }: Props) {
  const matchedGoogle = findGoogleFont(value);
  const initialMode: "google" | "custom" = matchedGoogle || !value ? "google" : "custom";
  const [mode, setMode] = useState<"google" | "custom">(initialMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Preload the current font so the trigger shows the right typeface.
  useEffect(() => {
    if (matchedGoogle) ensureGoogleFontLoaded(matchedGoogle.family);
  }, [matchedGoogle]);

  // Recompute dropdown position from the trigger rect. Runs on open and on
  // scroll/resize while open so the dropdown follows the trigger if the modal
  // body scrolls underneath it.
  useLayoutEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  // Close dropdown on outside click / Escape. With the dropdown in a portal,
  // we need to check both the trigger wrapper and the dropdown itself before
  // dismissing.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: GoogleFont[] = q
      ? GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q))
      : GOOGLE_FONTS;
    return list;
  }, [query]);

  const triggerLabel = matchedGoogle
    ? matchedGoogle.family
    : value
    ? primaryFamilyName(value) || "Custom"
    : "Elegir tipografía";

  const triggerFontFamily = matchedGoogle ? fontFamilyCss(matchedGoogle.family) : value || undefined;

  if (mode === "custom") {
    return (
      <div className="flex items-center gap-1 w-full">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono"
          placeholder="Inter, system-ui, sans-serif"
        />
        <button
          type="button"
          onClick={() => setMode("google")}
          className="text-[10px] px-2 py-1.5 rounded border border-border/50 hover:bg-muted text-muted-foreground"
          title="Volver al selector de Google Fonts"
        >
          Google Fonts
        </button>
      </div>
    );
  }

  const dropdown =
    open && dropdownPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[200] bg-background border border-border/60 rounded-md shadow-xl overflow-hidden"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
          >
            <div className="p-2 border-b border-border/40 flex items-center gap-2">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar Google Font…"
                className="flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  Sin coincidencias.
                </p>
              ) : (
                filtered.map((font) => (
                  <FontRow
                    key={font.family}
                    font={font}
                    active={matchedGoogle?.family === font.family}
                    onPick={() => {
                      onChange(fontFamilyCss(font.family));
                      ensureGoogleFontLoaded(font.family);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setMode("custom");
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 border-t border-border/40 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Escribir manualmente (stack CSS personalizado)
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs hover:bg-muted/70",
          !matchedGoogle && "text-muted-foreground"
        )}
        style={{ fontFamily: triggerFontFamily }}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {dropdown}
    </div>
  );
}

// Lazily previews each row in its own typeface. Loading happens on hover so we
// don't trigger 80 simultaneous requests when the dropdown opens.
function FontRow({
  font,
  active,
  onPick,
}: {
  font: GoogleFont;
  active: boolean;
  onPick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (hovered) ensureGoogleFontLoaded(font.family);
  }, [hovered, font.family]);

  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onFocus={() => setHovered(true)}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-muted",
        active && "bg-primary/10"
      )}
      style={{ fontFamily: hovered ? fontFamilyCss(font.family) : undefined }}
    >
      <span className="text-sm truncate">{font.family}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
        {font.category}
      </span>
    </button>
  );
}
