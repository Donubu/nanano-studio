"use client";

import { useState } from "react";
import { ChevronDown, Tags } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GEMINI_AUDIO_TAGS } from "@/types/audio";

interface AudioTagPaletteProps {
  /** Inserta el snippet (ej. "[excited] ") en la posición actual del cursor. */
  onInsert: (snippet: string) => void;
  disabled?: boolean;
}

/**
 * Paleta de "audio tags" expresivos para Gemini TTS. Al hacer click en un chip
 * inserta el tag inline en el texto a sintetizar (ej. "[laughs]"). Rinden mejor
 * con Gemini 3.1 Flash TTS; soporte parcial en los TTS 2.5.
 */
export function AudioTagPalette({ onInsert, disabled = false }: AudioTagPaletteProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        disabled={disabled}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Tags className="w-4 h-4" />
        <span>Audio tags expresivos</span>
        <ChevronDown
          className={`w-4 h-4 ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-3">
        {GEMINI_AUDIO_TAGS.map((group) => (
          <div key={group.category} className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              {group.category}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.tags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  disabled={disabled}
                  onClick={() => onInsert(`[${t.tag}] `)}
                  title={`Inserta [${t.tag}]`}
                  className="px-2 py-1 text-xs rounded-md border border-border/60 bg-muted/40 hover:bg-accent hover:border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t.label}
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    [{t.tag}]
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/30">
          Los tags se insertan dentro del texto y ajustan la entrega en ese punto.
          Rinden mejor con Gemini 3.1 Flash TTS.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
