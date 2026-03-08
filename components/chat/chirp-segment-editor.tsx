"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, Trash2, GripVertical, Timer, Type, Hash, Calendar, Phone, TextCursorInput, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- Types ---

export interface ChirpSegment {
  id: string;
  type: "text" | "pause";
  text: string;
  rate: string;     // x-slow, slow, medium, fast, x-fast
  pitch: number;    // -10 to +10 semitones
  pauseDuration: string; // 0.5s, 1s, 1.5s, 2s, 3s
}

export interface ChirpPreset {
  name: string;
  description: string;
  rate: string;
  pitch: number;
}

// --- Constants ---

export const CHIRP_PRESETS: ChirpPreset[] = [
  { name: "Narrador documental", description: "Lento, tono grave", rate: "slow", pitch: -1 },
  { name: "Locutor de noticias", description: "Velocidad normal, tono neutro", rate: "medium", pitch: 0 },
  { name: "Cuento infantil", description: "Lento, tono agudo", rate: "slow", pitch: 2 },
  { name: "Podcast casual", description: "Natural, relajado", rate: "medium", pitch: 0 },
  { name: "Anuncio comercial", description: "Rápido, energético", rate: "fast", pitch: 2 },
  { name: "Voz en off épica", description: "Muy lento, tono muy grave", rate: "x-slow", pitch: -4 },
  { name: "Asistente virtual", description: "Rápido, tono medio-alto", rate: "fast", pitch: 1 },
];

const RATE_OPTIONS = [
  { value: "x-slow", label: "Muy lenta" },
  { value: "slow", label: "Lenta" },
  { value: "medium", label: "Normal" },
  { value: "fast", label: "Rápida" },
  { value: "x-fast", label: "Muy rápida" },
];

const PITCH_OPTIONS = [
  { value: -6, label: "-6st" },
  { value: -4, label: "-4st" },
  { value: -2, label: "-2st" },
  { value: -1, label: "-1st" },
  { value: 0, label: "0" },
  { value: 1, label: "+1st" },
  { value: 2, label: "+2st" },
  { value: 4, label: "+4st" },
  { value: 6, label: "+6st" },
];

const PAUSE_DURATIONS = [
  { value: "0.3s", label: "0.3s" },
  { value: "0.5s", label: "0.5s" },
  { value: "1s", label: "1s" },
  { value: "1.5s", label: "1.5s" },
  { value: "2s", label: "2s" },
  { value: "3s", label: "3s" },
];

const SAY_AS_OPTIONS = [
  { type: "cardinal", label: "Número", icon: Hash, example: '123 → "ciento veintitrés"' },
  { type: "ordinal", label: "Ordinal", icon: Hash, example: '3 → "tercero"' },
  { type: "characters", label: "Deletrear", icon: Type, example: 'ABC → "a, be, ce"' },
  { type: "date", label: "Fecha", icon: Calendar, example: "18-02-2026", format: 'format="dmy"' },
  { type: "time", label: "Hora", icon: Calendar, example: "14:30:00", format: 'format="hms24"' },
  { type: "telephone", label: "Teléfono", icon: Phone, example: "+56912345678" },
  { type: "unit", label: "Unidad", icon: Hash, example: '5km → "cinco kilómetros"' },
  { type: "fraction", label: "Fracción", icon: Hash, example: '3/4 → "tres cuartos"' },
];

// --- Helpers ---

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

export function createDefaultSegment(preset?: ChirpPreset): ChirpSegment {
  return {
    id: generateId(),
    type: "text",
    text: "",
    rate: preset?.rate || "medium",
    pitch: preset?.pitch ?? 0,
    pauseDuration: "1s",
  };
}

export function createDefaultSegments(): ChirpSegment[] {
  return [createDefaultSegment()];
}

export function segmentsToSSML(segments: ChirpSegment[]): string {
  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.type === "pause") {
      parts.push(`<break time="${seg.pauseDuration}"/>`);
      continue;
    }

    const trimmed = seg.text.trim();
    if (!trimmed) continue;

    const hasRate = seg.rate !== "medium";
    const hasPitch = seg.pitch !== 0;

    if (hasRate || hasPitch) {
      const attrs: string[] = [];
      if (hasRate) attrs.push(`rate="${seg.rate}"`);
      if (hasPitch) attrs.push(`pitch="${seg.pitch > 0 ? "+" : ""}${seg.pitch}st"`);
      parts.push(`<prosody ${attrs.join(" ")}>${trimmed}</prosody>`);
    } else {
      parts.push(trimmed);
    }
  }

  if (parts.length === 0) return "";

  // If no prosody/break tags used, return plain text
  const hasSSML = parts.some(p =>
    p.startsWith("<prosody") || p.startsWith("<break") ||
    p.includes("<say-as") || p.includes("<sub ") || p.includes("<phoneme")
  );

  if (!hasSSML) {
    return parts.join("\n\n");
  }

  return `<speak>\n${parts.map(p => `  ${p}`).join("\n")}\n</speak>`;
}

export function segmentsToPlainText(segments: ChirpSegment[]): string {
  return segments
    .filter(s => s.type === "text" && s.text.trim())
    .map(s => s.text.trim())
    .join("\n\n");
}

// --- Component ---

interface ChirpSegmentEditorProps {
  segments: ChirpSegment[];
  onSegmentsChange: (segments: ChirpSegment[]) => void;
  disabled?: boolean;
  defaultPreset?: ChirpPreset;
}

export function ChirpSegmentEditor({
  segments,
  onSegmentsChange,
  disabled = false,
  defaultPreset,
}: ChirpSegmentEditorProps) {
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  const setTextareaRef = useCallback((id: string, el: HTMLTextAreaElement | null) => {
    if (el) {
      textareaRefs.current.set(id, el);
    } else {
      textareaRefs.current.delete(id);
    }
  }, []);

  // --- Segment CRUD ---

  const addTextSegment = () => {
    onSegmentsChange([...segments, createDefaultSegment(defaultPreset || undefined)]);
  };

  const addPauseSegment = (duration = "1s") => {
    const pause: ChirpSegment = {
      id: generateId(),
      type: "pause",
      text: "",
      rate: "medium",
      pitch: 0,
      pauseDuration: duration,
    };
    onSegmentsChange([...segments, pause]);
  };

  const removeSegment = (id: string) => {
    if (segments.length <= 1) return;
    onSegmentsChange(segments.filter(s => s.id !== id));
  };

  const updateSegment = (id: string, updates: Partial<ChirpSegment>) => {
    onSegmentsChange(segments.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  // --- Inline SSML insertion ---

  const getActiveTextarea = (): HTMLTextAreaElement | null => {
    if (!activeSegmentId) return null;
    return textareaRefs.current.get(activeSegmentId) || null;
  };

  const insertOrWrapInActiveSegment = (before: string, after: string, placeholder = "") => {
    const textarea = getActiveTextarea();
    if (!textarea || !activeSegmentId) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    const insertText = selectedText || placeholder;
    const newText = text.substring(0, start) + before + insertText + after + text.substring(end);

    updateSegment(activeSegmentId, { text: newText });

    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      const ta = textareaRefs.current.get(activeSegmentId);
      if (ta) {
        const cursorPos = start + before.length + insertText.length;
        ta.focus();
        ta.setSelectionRange(
          selectedText ? start : cursorPos,
          cursorPos
        );
      }
    });
  };

  const handleSayAs = (type: string) => {
    const option = SAY_AS_OPTIONS.find(o => o.type === type);
    const formatAttr = option?.format ? ` ${option.format}` : "";
    insertOrWrapInActiveSegment(
      `<say-as interpret-as="${type}"${formatAttr}>`,
      `</say-as>`,
      option?.example || "texto"
    );
  };

  const handleSub = () => {
    const alias = prompt("Texto de reemplazo (alias):");
    if (alias === null) return;
    insertOrWrapInActiveSegment(
      `<sub alias="${alias}">`,
      `</sub>`,
      "sigla"
    );
  };

  const handleInlineBreak = (duration: string) => {
    const textarea = getActiveTextarea();
    if (!textarea || !activeSegmentId) return;

    const pos = textarea.selectionStart;
    const text = textarea.value;
    const breakTag = `<break time="${duration}"/>`;
    const newText = text.substring(0, pos) + breakTag + text.substring(pos);

    updateSegment(activeSegmentId, { text: newText });

    requestAnimationFrame(() => {
      const ta = textareaRefs.current.get(activeSegmentId);
      if (ta) {
        const cursorPos = pos + breakTag.length;
        ta.focus();
        ta.setSelectionRange(cursorPos, cursorPos);
      }
    });
  };

  const hasActiveTextSegment = activeSegmentId && segments.find(s => s.id === activeSegmentId && s.type === "text");

  return (
    <div className="space-y-3">
      {/* Inline SSML Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap p-2 bg-muted/50 rounded-lg border border-border/50">
        <span className="text-[10px] text-muted-foreground font-medium mr-1 uppercase tracking-wider">Insertar:</span>

        {/* Inline Break */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={disabled || !hasActiveTextSegment}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-muted hover:bg-accent border border-border/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Timer className="w-3 h-3" />
              Pausa
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuLabel className="text-[10px]">Duración</DropdownMenuLabel>
            {PAUSE_DURATIONS.map(d => (
              <DropdownMenuItem key={d.value} onClick={() => handleInlineBreak(d.value)}>
                {d.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Say-as */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={disabled || !hasActiveTextSegment}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-muted hover:bg-accent border border-border/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <TextCursorInput className="w-3 h-3" />
              Interpretar
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            <DropdownMenuLabel className="text-[10px]">Interpretar como...</DropdownMenuLabel>
            {SAY_AS_OPTIONS.map(opt => (
              <DropdownMenuItem key={opt.type} onClick={() => handleSayAs(opt.type)}>
                <div className="flex flex-col">
                  <span>{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground">{opt.example}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sub (alias) */}
        <button
          onClick={handleSub}
          disabled={disabled || !hasActiveTextSegment}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-muted hover:bg-accent border border-border/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Layers className="w-3 h-3" />
          Alias
        </button>

        {!hasActiveTextSegment && (
          <span className="text-[10px] text-muted-foreground/60 italic ml-1">
            Selecciona un segmento de texto
          </span>
        )}
      </div>

      {/* Segments List */}
      <div className="space-y-2">
        {segments.map((seg, index) => (
          <div key={seg.id}>
            {seg.type === "pause" ? (
              /* Pause Segment */
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 rounded-lg border border-amber-500/20">
                <Timer className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pausa</span>
                <div className="flex gap-1 flex-1">
                  {PAUSE_DURATIONS.map(d => (
                    <button
                      key={d.value}
                      onClick={() => updateSegment(seg.id, { pauseDuration: d.value })}
                      disabled={disabled}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                        seg.pauseDuration === d.value
                          ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-medium"
                          : "text-muted-foreground hover:bg-muted"
                      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSegment(seg.id)}
                  disabled={disabled || segments.length <= 1}
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              /* Text Segment */
              <div className={`rounded-lg border transition-colors ${
                activeSegmentId === seg.id
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 bg-card"
              }`}>
                {/* Segment Header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
                  <GripVertical className="w-3 h-3 text-muted-foreground/40" />
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {segments.filter(s => s.type === "text").findIndex(s => s.id === seg.id) + 1}
                  </span>

                  {/* Rate */}
                  <select
                    value={seg.rate}
                    onChange={(e) => updateSegment(seg.id, { rate: e.target.value })}
                    disabled={disabled}
                    className="h-6 text-[11px] bg-muted/50 border border-border/50 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    {RATE_OPTIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>

                  {/* Pitch */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Tono:</span>
                    <select
                      value={seg.pitch}
                      onChange={(e) => updateSegment(seg.id, { pitch: Number(e.target.value) })}
                      disabled={disabled}
                      className="h-6 text-[11px] bg-muted/50 border border-border/50 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      {PITCH_OPTIONS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1" />

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSegment(seg.id)}
                    disabled={disabled || segments.length <= 1}
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>

                {/* Segment Text */}
                <div className="p-2">
                  <Textarea
                    ref={(el) => setTextareaRef(seg.id, el)}
                    value={seg.text}
                    onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                    onFocus={() => setActiveSegmentId(seg.id)}
                    placeholder="Escribe el texto de este segmento..."
                    disabled={disabled}
                    className="min-h-[60px] text-sm resize-none border-0 bg-transparent p-0 focus-visible:ring-0 shadow-none"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Segment Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={addTextSegment}
          disabled={disabled || segments.filter(s => s.type === "text").length >= 20}
          className="flex-1 h-8 border-dashed text-xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Texto
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => addPauseSegment("1s")}
          disabled={disabled}
          className="h-8 border-dashed text-xs"
        >
          <Timer className="w-3.5 h-3.5 mr-1" />
          Pausa
        </Button>
      </div>
    </div>
  );
}
