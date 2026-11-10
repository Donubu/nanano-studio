"use client";

import {
  forwardRef,
  useCallback,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import { useCanvasContext } from "../canvas-context";

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Controlled textarea designed for canvas nodes. Keeps a local copy of the
 * value so the caret position doesn't jump to the end of the text when the
 * parent re-renders mid-typing (autosave, collab broadcasts, alternative
 * tab swaps, etc. all trigger re-renders that would otherwise reset the
 * caret with a plain controlled `<textarea value={prop} />`).
 *
 * Behavior:
 *   - User keystrokes update local state and propagate to the parent in the
 *     same event tick.
 *   - When the external `value` prop differs from the local state — meaning
 *     someone other than this textarea changed it (undo, switching tabs,
 *     remote update) — local state syncs to match. The caret will reset in
 *     that case, which is acceptable.
 */
export const NodeTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function NodeTextarea({ value, onChange, ...rest }, ref) {
    const { canEdit } = useCanvasContext();
    const [local, setLocal] = useState(value);
    // Último valor externo visto. Cuando el `value` de afuera cambia (otro
    // editor, el panel lateral, deshacer, colaboración) se sincroniza DURANTE
    // el render y no en un useEffect: con muchas actualizaciones seguidas
    // (escritura rápida en otro campo que edita el mismo dato), el efecto
    // encadenaba un setState por commit y React cortaba con "Maximum update
    // depth exceeded". Las propias teclas no cambian nada: local ya es igual.
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
      setLastValue(value);
      if (value !== local) setLocal(value);
    }

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const v = e.target.value;
        setLocal(v);
        onChange(v);
      },
      [onChange]
    );

    // Always force `nodrag nowheel` so xyflow doesn't intercept dragging or
    // wheel scrolling inside the textarea (would otherwise zoom the canvas).
    const { className: incomingClassName, readOnly: incomingReadOnly, ...restProps } = rest;
    const className = ["nodrag", "nowheel", incomingClassName].filter(Boolean).join(" ");

    return (
      <textarea
        ref={ref}
        value={local}
        onChange={handleChange}
        // En solo-ver no se edita (sigue seleccionable para copiar).
        readOnly={!canEdit || incomingReadOnly}
        className={className}
        {...restProps}
      />
    );
  }
);
