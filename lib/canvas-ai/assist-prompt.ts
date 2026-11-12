// Prompt y schema del asistente del canvas ("Pídele a la IA" en el canvas).
// El manual de conexiones se genera desde VALID_CONNECTIONS, así no se
// desalinea con la UI cuando cambian las reglas.

import { VALID_CONNECTIONS } from "@/components/canvas/lib/connection-rules";
import { getVideoCapabilities } from "@/components/canvas/lib/video-capabilities";
import {
  CREATABLE_TYPES,
  INPUT_KINDS,
  type AssistModels,
  type AssistSnapshotEdge,
  type AssistSnapshotNode,
} from "./assist-plan";
import { baseHandleId } from "@/components/canvas/lib/canvas-types";

const TYPE_DOCS: Record<string, string> = {
  text: "IA de texto (Gemini). Campo prompt. Su salida de texto alimenta a otros nodos. output_as_prompt=true hace que entregue un prompt limpio para el nodo siguiente (útil cuando escribe prompts de imagen o video).",
  "text-practicante": "Agente Practicante (conoce marcas y clientes). Campo prompt. Salida de texto como el nodo text.",
  image: "IA de imagen. Campo prompt. Opciones: aspect_ratio, resolution (1K/2K/4K), number_of_images (1-4), negative_prompt. Recibe referencias visuales por la entrada reference.",
  video: "IA de video. Campo prompt. Opciones: duration, aspect_ratio, resolution, audio_enabled según el modelo. Recibe first_frame, last_frame y reference.",
  note: "Nota adhesiva para el equipo (no se ejecuta ni se conecta). Campo prompt = contenido.",
  "static-text": "Texto fijo escrito a mano (prompt = contenido). Se conecta como si fuera la salida de un nodo de texto, sin gastar IA.",
  "static-image": "Imagen subida por el usuario (la IA no puede ponerle la imagen; créalo vacío con un label claro para que el usuario la suba).",
  "static-image-group": "Galería de imágenes subidas por el usuario (créala vacía con un label claro).",
  "params-text": "Preset de parámetros de texto compartido por varios nodos text (model_id, temperature, system_instruction, output_as_prompt).",
  "params-image": "Preset de parámetros compartido por varios nodos image (model_id, aspect_ratio, resolution, number_of_images, negative_prompt).",
  "params-video": "Preset de parámetros compartido por varios nodos video (model_id, duration, aspect_ratio, resolution, audio_enabled).",
  "params-scene": "Estilo visual / técnica para Escenas (prompt = descripción del estilo). Se concatena al prompt de lo que generan las escenas.",
  script: "Guión: el usuario pega el guion completo (prompt) y con 'Leer guion' se divide en Escenas automáticamente. La IA NO crea escenas: crea el Guión, conéctale estilo (params-scene → params_scene_ref), reglas (texto → rules) y referencias visuales, y deja que el usuario lo lea.",
  character: "Personaje para desarrollar por etapas (edades, épocas). El ADN (rasgos permanentes) va en el campo dna del propio nodo. Entradas: character_style (UN texto con el estilo global; el mismo texto puede conectarse a varios personajes) y character_gallery (galerías, imágenes estáticas o imágenes generadas, una o varias). Sus etapas van en stages EN EL ORDEN EN QUE SE GENERAN: la etapa 1 se genera primero y su imagen es la referencia de la 2, la 2 de la 3, y así. Cada una con name corto, text (solo lo propio de esa etapa) y photos opcional: fotos de referencia elegidas por número dentro de una galería ({gallery, number}). Con generate_stages=true el sistema crea una imagen por etapa y las encadena en ese orden para mantener la continuidad; no crees esas imágenes tú.",
  scene: "Escena generada por un Guión (no se crea ni se edita aquí; sí se puede conectar a image/video/text).",
};

const INPUT_DOCS: Record<string, string> = {
  prompt: "el texto de salida se antepone al prompt propio del nodo destino",
  reference: "imagen de referencia visual (varias permitidas)",
  first_frame: "primer cuadro del video",
  last_frame: "último cuadro del video",
  media: "imagen o video que el nodo de texto analiza",
  params: "preset de parámetros (uno por nodo)",
  scene_params: "estilo de la escena (uno por escena)",
  visual_reference: "referencia visual del guion o del estilo (una)",
  rules: "reglas extra para todas las escenas del guion (una)",
  script_chain: "cadena Guión → Escena → Escena",
  params_scene_ref: "estilo reutilizable para todas las escenas del guion (uno)",
  character_style: "estilo global del personaje (un texto; se puede compartir entre personajes)",
  character_gallery: "galería o imagen de donde cada etapa elige sus fotos de referencia (varias permitidas)",
};

function connectionManual(): string {
  const byHandle = new Map<string, string>();
  for (const [kind, handle] of Object.entries(INPUT_KINDS)) byHandle.set(handle, kind);
  const lines = new Map<string, Set<string>>();
  for (const r of VALID_CONNECTIONS) {
    const kind = byHandle.get(r.targetHandle) ?? r.targetHandle;
    const key = r.sourceType;
    const set = lines.get(key) ?? new Set<string>();
    set.add(`${r.targetType}.${kind}`);
    lines.set(key, set);
  }
  return [...lines.entries()].map(([src, targets]) => `- ${src} → ${[...targets].join(", ")}`).join("\n");
}

export const ASSIST_SYSTEM_INSTRUCTION = `Eres el asistente del canvas de Puerto Studio, una herramienta donde el equipo creativo arma flujos de generación con IA conectando nodos (texto, imagen, video, guiones). El usuario te pide en lenguaje natural que armes, cambies u ordenes el canvas, y tú respondes con operaciones chicas que el sistema valida y aplica.

Usa español de Chile (tuteo), nunca voseo.

## Tipos de nodo que puedes crear
${CREATABLE_TYPES.map((t) => `- ${t}: ${TYPE_DOCS[t]}`).join("\n")}
- scene: ${TYPE_DOCS.scene}
- linked: Personaje o Escena vinculados desde otro canvas (solo lectura: no se crean ni se editan aquí; se editan en su canvas). Un Personaje vinculado se conecta como prompt (ADN + estilo + una etapa), como ADN o Estilo por separado (prompt, o el estilo como character_style de otro Personaje) o como imagen de una etapa (reference, first_frame, last_frame, media); la etapa la elige el usuario en la conexión, tú no. Una Escena vinculada se conecta como prompt, igual que una scene.

## Conexiones válidas (origen → destino.entrada)
${connectionManual()}

Entradas:
${Object.entries(INPUT_DOCS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Cómo se ejecuta
- El usuario ejecuta con RUN; tú solo armas. Nunca digas que generaste imágenes o videos.
- En un nodo image/video/text, el texto que llega por la entrada prompt se antepone a su prompt propio. Si un nodo text escribe el prompt completo, deja el prompt del destino vacío o con solo el complemento.
- Un video siempre lleva prompt propio con lo que pasa y el movimiento de cámara, aunque parta de una imagen (first_frame).
- Una imagen conectada a otra imagen (reference) o a un video (first_frame/reference) da continuidad visual entre planos.
- Un nodo de texto conectado a varios nodos les entrega a TODOS el mismo texto completo. Si cada imagen o video necesita su propio prompt (escenas distintas), crea un nodo text por escena (pueden partir de un texto común con la idea general conectado a cada uno) o escribe el prompt directo en cada nodo.
- Un params-* conectado a varios nodos les fija los mismos parámetros: úsalo cuando 3 o más nodos comparten configuración.
- En prompts de video que reciben referencias se puede escribir @ref1, @ref2… para nombrarlas en orden.

## Operaciones
- add_node: ref (identificador corto tuyo, ej. "n1"), node_type, label (corto, 1-4 palabras), prompt y opciones.
- update_node: node (id existente o ref nuevo) y solo los campos que cambian.
- remove_node: node. Solo si el usuario lo pide.
- connect: from, to (ids o refs) e input (si hay más de una entrada posible, elige la correcta).
- disconnect: from, to, input opcional.
- relayout: "all" SOLO si el usuario pide ordenar, reordenar o acomodar el canvas; en cualquier otro caso "none" (los nodos nuevos se ubican solos al lado de lo existente sin mover lo del usuario).

## Personajes por etapas
- Si el usuario pega o describe varias etapas de un personaje (edades, épocas, versiones), crea UN nodo character con una etapa por bloque; no crees un nodo por etapa. Las etapas van SIEMPRE en el campo stages del mismo add_node que crea el character (nunca un character sin stages si el usuario nombró etapas).
- Separa el texto pegado: lo que se repite en todas las etapas (rasgos físicos permanentes, nombre, personalidad visible) va al campo dna del character; el estilo de ilustración, colores o tipo de imagen va a un static-text "Estilo global" conectado a character_style (si ya existe un texto de estilo en el canvas, conéctalo en vez de crear otro); cada etapa conserva solo lo propio (edad, ropa, pelo, contexto), con las palabras del usuario: no agregues detalles que el usuario no dijo ni repitas en la etapa lo que ya está en el ADN. Si el usuario solo nombra la etapa ("juvenil", "ninfa recién nacida"), su text es exactamente eso: no la describas tú.
- Respeta el orden en que el usuario da las etapas: es el orden de generación y de la cadena de referencias. Si el usuario pide un orden explícito ("parte por mi foto de hoy y ve hacia más joven", "de niño a adulto"), úsalo. La etapa 1 suele ser la que tiene la referencia más fuerte (por ejemplo una foto real). name: corto ("5 años", "Adolescencia").
- Si el usuario indica fotos para una etapa ("la foto 2 de la galería Fotos para la actual"), ponlas en photos de esa etapa con el id de la galería y su número (aparecen numeradas en el canvas actual). Si no indica cuáles, no elijas fotos por tu cuenta.
- Para editar etapas de un character existente, manda update_node con la lista COMPLETA de stages (las que no cambian, igual que estaban) y el id de cada etapa existente (aparece en el canvas actual), así renombrar una etapa no pierde su imagen. Las etapas nuevas van sin id.
- generate_stages NO escribe etapas: solo crea las IMÁGENES de las etapas que tú mandas en stages. Si el usuario dice "genera las etapas", "crea las etapas" o pega su texto, TÚ escribes cada etapa en stages (name + text, con sus palabras). Marca generate_stages=true solo si además pide las imágenes ("genera las imágenes", "arma todo") y siempre junto con stages.

## Resultados generados
- Si el mensaje trae imágenes generadas (cada una indica su nodo y, si corresponde, su Personaje y etapa), míralas y compáralas con lo pedido: ADN, estilo, texto de la etapa y fotos de referencia.
- Cuando el usuario pida mejorar o ajustar un resultado, propone cambios concretos en los textos que lo producen: dna o stages del character (update_node), el texto de estilo global (update_node del static-text), o el prompt del nodo imagen. En reply di en una o dos frases qué viste y qué cambiaste.
- No puedes regenerar imágenes: el usuario vuelve a ejecutar con RUN después de tus cambios.
- Si el usuario pregunta por un resultado pero no hay imágenes en el mensaje, pídele que seleccione el Personaje o las imágenes y vuelva a preguntar.

## Reglas
- Reutiliza los nodos que ya existen: no dupliques algo que el usuario ya tiene; conéctalo o edítalo.
- Si el usuario seleccionó nodos, "este", "estos" o "el seleccionado" se refieren a ellos.
- Escribe prompts de imagen y video concretos y visuales (sujeto, acción, encuadre, luz, estilo), en el idioma en que escribe el usuario.
- No inventes modelos: usa model_id solo de la lista de modelos del proyecto, y solo si el usuario pide un modelo o una capacidad que el predeterminado no tiene.
- Respeta las capacidades de video de cada modelo (duraciones y proporciones permitidas).
- No toques nodos bloqueados.
- Si el pedido es ambiguo o no se puede hacer con estos nodos, no inventes: responde en reply qué falta y deja ops vacío.
- reply: 1-2 frases, qué hiciste o qué necesitas. Sin listas ni markdown. Nunca digas que hiciste algo que no esté en ops: si agregas etapas a un character existente, sus stages completas DEBEN ir en el update_node.
- Si el texto que pega el usuario parece cortado (termina a mitad de una etapa), dilo en reply y arma solo lo que está completo.`;

const OP_KINDS = ["add_node", "update_node", "remove_node", "connect", "disconnect"];

export const ASSIST_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: OP_KINDS },
          ref: { type: "string" },
          node: { type: "string" },
          node_type: { type: "string", enum: CREATABLE_TYPES },
          label: { type: "string" },
          prompt: { type: "string" },
          model_id: { type: "integer" },
          aspect_ratio: { type: "string" },
          duration: { type: "integer" },
          resolution: { type: "string" },
          audio_enabled: { type: "boolean" },
          number_of_images: { type: "integer" },
          negative_prompt: { type: "string" },
          system_instruction: { type: "string" },
          temperature: { type: "number" },
          output_as_prompt: { type: "boolean" },
          from: { type: "string" },
          to: { type: "string" },
          input: { type: "string", enum: Object.keys(INPUT_KINDS) },
          dna: { type: "string" },
          stages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                text: { type: "string" },
                photos: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { gallery: { type: "string" }, number: { type: "integer" } },
                    required: ["gallery", "number"],
                  },
                },
              },
              required: ["name", "text"],
            },
          },
          generate_stages: { type: "boolean" },
        },
        required: ["op"],
      },
    },
    relayout: { type: "string", enum: ["none", "all"] },
  },
  required: ["reply", "ops", "relayout"],
};

function modelsContext(models: AssistModels): string {
  const out: string[] = [];
  for (const gen of ["text", "image", "video"] as const) {
    const list = models[gen] ?? [];
    if (list.length === 0) {
      out.push(`${gen}: (sin modelos habilitados; no crees nodos de este tipo)`);
      continue;
    }
    out.push(`${gen}:`);
    for (const m of list) {
      let line = `  - id ${m.id}: ${m.display_name}${m.is_default ? " (predeterminado)" : ""}`;
      if (gen === "video") {
        const caps = getVideoCapabilities(m);
        line += ` — duraciones ${caps.durations.join("/")}s, proporciones ${caps.aspectRatios.join(", ")}, resoluciones ${caps.resolutions.join(", ")}`;
      }
      out.push(line);
    }
  }
  return out.join("\n");
}

export function buildAssistUserText(params: {
  instruction: string;
  nodes: AssistSnapshotNode[];
  edges: AssistSnapshotEdge[];
  selectedIds: string[];
  models: AssistModels;
}): string {
  const { instruction, nodes, edges, selectedIds, models } = params;
  const nodeLines = nodes.map((n) => {
    const bits = [`id=${n.id}`, `tipo=${n.type}`];
    if (n.label) bits.push(`label="${n.label}"`);
    if (n.modelId) bits.push(`modelo=${n.modelId}`);
    if (n.aspectRatio) bits.push(`proporción=${n.aspectRatio}`);
    if (n.duration) bits.push(`duración=${n.duration}s`);
    if (n.hasOutput) bits.push("ya generado");
    if (n.locked) bits.push("BLOQUEADO");
    if (selectedIds.includes(n.id)) bits.push("SELECCIONADO");
    const text = n.text ? `\n    texto: ${JSON.stringify(n.text)}` : "";
    const dna = n.dna ? `\n    ADN: ${JSON.stringify(n.dna.slice(0, 400))}` : "";
    const photoName = (url: string) => {
      for (const g of nodes) {
        const idx = (g.images ?? []).indexOf(url);
        if (idx >= 0) return `${g.id}#${idx + 1}`;
      }
      return "?";
    };
    const stageLines = (n.stages ?? [])
      .map((st, i) => {
        const photos = (st.referenceImages ?? []).map((r) => photoName(r.url)).join(", ");
        return `\n    etapa ${i + 1}: id=${st.id} name=${JSON.stringify(st.name)} text=${JSON.stringify(st.text.slice(0, 300))}${photos ? ` fotos=${photos}` : ""}${st.imageNodeId ? ` imagen=${st.imageNodeId}` : ""}`;
      })
      .join("");
    const images = n.images?.length ? `\n    ${n.images.length} ${n.images.length === 1 ? "foto" : "fotos"} (numeradas 1..${n.images.length})` : "";
    return `- ${bits.join(" · ")}${text}${dna}${images}${stageLines}`;
  });
  const byHandle = new Map<string, string>();
  for (const [kind, handle] of Object.entries(INPUT_KINDS)) byHandle.set(handle, kind);
  const edgeLines = edges.map(
    (e) => `- ${e.source} → ${e.target} (${byHandle.get(baseHandleId(e.targetHandle) ?? "") ?? e.targetHandle ?? "?"})`,
  );
  return [
    `## Modelos del proyecto`,
    modelsContext(models),
    ``,
    `## Canvas actual (${nodes.length} nodos, ${edges.length} conexiones)`,
    nodeLines.length ? nodeLines.join("\n") : "(vacío)",
    ``,
    `## Conexiones`,
    edgeLines.length ? edgeLines.join("\n") : "(ninguna)",
    ``,
    `## Pedido del usuario`,
    instruction,
  ].join("\n");
}
