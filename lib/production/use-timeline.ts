// Hook de estado para el editor visual de timeline.
//
// Maneja: currentTime (ms), isPlaying, timelineCollapsed. Cuando isPlaying,
// avanza currentTime con requestAnimationFrame respetando la duration del
// timeline y el loop count del AnimationConfig.
//
// El hook NO conoce la AnimationConfig en sí — solo la duration y el loop.
// La razón: el hook vive arriba del TimelinePanel, mientras que la config
// vive en TemplateDefinition.animation. El caller (TemplateEditor) pasa
// duration/loop como props leídos del editor.

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseTimelineOptions {
  // Si no hay animation en la def, duration es undefined → seek/play se
  // tratan como no-ops. UI muestra "Crear timeline" en vez de tracks.
  duration: number | undefined;
  // Número de iteraciones. Cuando se llega al último loop, currentTime
  // queda en duration y isPlaying pasa a false.
  loop: number | "infinite" | undefined;
}

export interface UseTimelineResult {
  currentTime: number;
  isPlaying: boolean;
  timelineCollapsed: boolean;
  setCurrentTime: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  // Llevar el playhead a t=0 (reinicio explícito; no afecta isPlaying).
  rewind: () => void;
  setTimelineCollapsed: (collapsed: boolean) => void;
  toggleTimelineCollapsed: () => void;
}

export function useTimeline({
  duration,
  loop,
}: UseTimelineOptions): UseTimelineResult {
  const [currentTime, setCurrentTimeState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(true);

  // RAF loop. Para no acumular drift, calculamos delta = now - lastTickAt
  // en cada frame y lo sumamos al currentTime.
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  // loopsDoneRef: cuántas iteraciones del loop se completaron. Se compara
  // contra `loop` para saber si seguimos o frenamos.
  const loopsDoneRef = useRef<number>(0);

  const setCurrentTime = useCallback(
    (t: number) => {
      const d = duration ?? 0;
      const clamped = Math.max(0, Math.min(d, t));
      setCurrentTimeState(clamped);
    },
    [duration],
  );

  const play = useCallback(() => {
    if (!duration || duration <= 0) return;
    // Si el playhead estaba al final, reiniciar al 0 antes de arrancar.
    setCurrentTimeState((cur) => (cur >= duration ? 0 : cur));
    loopsDoneRef.current = 0;
    lastTickRef.current = performance.now();
    setIsPlaying(true);
  }, [duration]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const rewind = useCallback(() => {
    setCurrentTimeState(0);
    loopsDoneRef.current = 0;
    lastTickRef.current = performance.now();
  }, []);

  const toggleTimelineCollapsed = useCallback(() => {
    setTimelineCollapsed((v) => !v);
  }, []);

  // Loop principal. Solo corre cuando isPlaying es true. Se cancela cuando
  // isPlaying pasa a false o el componente se desmonta.
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const d = duration ?? 0;
    if (d <= 0) {
      setIsPlaying(false);
      return;
    }
    const maxLoops = loop === "infinite" ? Infinity : (loop ?? 1);
    const tick = (now: number) => {
      const last = lastTickRef.current || now;
      const delta = now - last;
      lastTickRef.current = now;
      setCurrentTimeState((cur) => {
        const next = cur + delta;
        if (next < d) return next;
        // Alcanzamos o pasamos el final del loop actual.
        loopsDoneRef.current += 1;
        if (loopsDoneRef.current >= maxLoops) {
          // Llegamos al último loop — clamp al final y stop.
          // Diferimos setIsPlaying(false) al próximo tick porque setStates
          // anidados en updater no son ideales; el siguiente render lo
          // levanta cuando vea isPlaying.
          queueMicrotask(() => setIsPlaying(false));
          return d;
        }
        // Wrap al inicio, conservando el overshoot.
        return next - d;
      });
      // Continuamos el loop. Lo cancelamos via cleanup cuando isPlaying
      // pase a false.
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, duration, loop]);

  // Si duration cambia (el productor edita la duration del timeline) y
  // el currentTime queda fuera de rango, lo clampeamos.
  useEffect(() => {
    if (duration == null) return;
    setCurrentTimeState((cur) => Math.max(0, Math.min(duration, cur)));
  }, [duration]);

  return {
    currentTime,
    isPlaying,
    timelineCollapsed,
    setCurrentTime,
    play,
    pause,
    togglePlayPause,
    rewind,
    setTimelineCollapsed,
    toggleTimelineCollapsed,
  };
}
