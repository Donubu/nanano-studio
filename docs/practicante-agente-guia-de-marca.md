# Practicante → nanano: lo que necesitamos de cada marca para producir banners

Contrato entre nanano (Puerto Studio, módulo de producción de banners) y los
agentes de cliente de Practicante.

Respuesta de Practicante: `practicante/docs/api-nanano-marca.md` (2026-10-28).
Confirma lo siguiente:
- deriva al agente del cliente por `client_slug`, sin pasar por el orquestador;
- agrega sola las reglas de este contrato;
- agrega el error `agent_forbidden`;
- una `BRAND_GUIDE` tarda entre 30 s y 2 min y cuesta entre USD 0,5 y 1.

## Contexto

- En Practicante **cada cliente tiene su agente**, con acceso a toda la
  información de la marca: brandbook y definiciones, estrategia, productos,
  campañas y **métricas**.
- nanano arma, adapta y anima los banners con su propio motor y Gemini. Antes
  eso lo hacía el agente "Banner Designer" de Practicante; se retiró porque
  era lento (~1 min y ~USD 0,15 por adaptación contra ~5 s y ~USD 0,003 ahora).
  **Ningún agente de Practicante debe diseñar banners, layouts, formatos ni
  animaciones** para nanano.
- Lo que nanano necesita de Practicante es el **conocimiento de la marca**:
  - qué decir: estrategia, productos, campañas y lo que rinde según métricas;
  - cómo decirlo: voz y lenguaje;
  - cómo se ve: identidad visual;
  - qué no se puede: reglas y legales.

El "Banner Designer" puede borrarse: nanano ya no lo llama.

## Interacciones

| # | Operación | Cuándo la usa nanano | Estado en nanano |
|---|-----------|----------------------|------------------|
| 1 | `BRAND_GUIDE` | "Sincronizar" en la ficha del cliente (Brand Kits). Queda como snapshot que usa toda la IA de producción. | **En uso** |
| 2 | `CAMPAIGN_BRIEF` | Antes de "Crear desde texto": brief de una pieza o campaña concreta. | Por implementar en nanano |
| 3 | `COPY_REVIEW` | Antes de exportar: validación de los textos de una pieza. | Por implementar en nanano |

La 1 es la prioridad. Las 2 y 3 se definen ahora para que el agente ya sepa
responderlas; nanano las va a ir conectando.

## Cómo llama nanano (las tres operaciones)

`POST {PRACTICANTE_URL}/api/external/run`, con los headers `X-API-Key` y
`X-User-Email`:

```json
{
  "message": "<pedido en lenguaje natural, ver cada operación>",
  "dryRun": false,
  "normalize": false,
  "returnOnlyFinalText": true,
  "context": {
    "responseFormat": "json",
    "promptSuffix": "{\"operation\":\"BRAND_GUIDE\",\"client_slug\":\"enaco\",\"instructions\":[...],\"schema\":{...}}"
  }
}
```

- **nanano no manda `agentName`.** Identifica a la marca por `client_slug`, el
  mismo slug que `Client.slug` en Practicante (los nombres de cliente no
  coinciden entre plataformas). Practicante deriva el pedido al agente
  principal activo de ese cliente, o al agente compartido que lo atiende (por
  ejemplo, los malls de Grupo Marina van al Especialista Grupo Marina). La
  respuesta trae en `delegatedTo` qué agente contestó.
  - También existe `context.agentName: "client:<slug>"`, que da el mismo
    resultado.
- Practicante agrega sola las reglas de este contrato. Las `instructions` del
  `promptSuffix` son redundantes, pero no molestan.
- No sirve con `dryRun: true`: las tools devuelven datos simulados. Las
  operaciones de marca solo leen, así que se prueban con `dryRun: false`.
- Timeout síncrono: 5 min. Existe `"async": true` + `GET
  /api/external/jobs/<jobId>`; nanano hoy usa el modo síncrono.
- `promptSuffix` es un JSON con `operation`, `client_slug`, `instructions` y
  `schema`. El agente debe responder siguiendo ese `schema`.
- nanano lee solo el texto final (`response`). Tolera texto o fences
  alrededor, pero lo ideal es **un único objeto JSON, sin markdown**.

## Reglas para el agente (todas las operaciones)

1. **No inventes.** Lo que no esté en la información de la marca queda vacío
   (`""`, `[]` o `null`). No rellenes con buenas prácticas genéricas.
2. **Toda afirmación que venga de métricas lleva su evidencia** en
   `resultado`: métrica, valor, comparación, canal y período. Por ejemplo:
   `"CTR 1,8% vs 0,9% promedio de la cuenta (Meta, jul–sep 2026)"`. Sin
   evidencia, no va.
3. Textos en **español de Chile**, con el tratamiento propio de la marca.
4. **Nombres exactos:** el de la marca y los de los productos se escriben tal
   como los escribe la marca (mayúsculas, tildes, signos). nanano los pone
   literalmente en las piezas.
5. Colores en **hex `#RRGGBB`**. Si el brandbook da Pantone, CMYK o RGB,
   conviértelos y anota el original en `uso`.
6. Precios en formato chileno: `$9.990`.
7. Respuestas concretas y accionables para quien diseña un banner: frases
   cortas, sin párrafos de estrategia corporativa.
8. Nunca diseñes piezas, layouts, formatos ni animaciones.

---

## 1. `BRAND_GUIDE` — guía de marca (en uso)

Lo estable de la marca. nanano la guarda como snapshot en
`clients.brand_guide_json` y se la pasa a toda la IA de producción:
- el planificador de "Crear desde texto";
- "Pídele a la IA" en el editor.

Se re-sincroniza a pedido. Practicante **no** se consulta durante cada
generación.

**Pedido (`message`):**
> Necesito la guía de marca completa del cliente con slug "enaco" para diseñar
> banners. Revisa su brandbook, su estrategia, productos y campañas, y sus
> métricas de campañas y piezas anteriores, y devuélvemelo en el JSON pedido.

**Respuesta:** los topes son los que aplica nanano al leer. Lo que se pasa se
recorta y lo inválido se descarta.

```jsonc
{
  "marca": "string",                        // nombre EXACTO (≤120)

  // CÓMO HABLA LA MARCA
  "voz": {
    "tono": "string",                       // 1-2 frases (≤600)
    "personalidad": ["adjetivo"],           // ≤12, ≤60 c/u
    "tratamiento": "tú | usted | voseo | otro",  // ≤300
    "palabras_usar": ["string"],            // ≤40, ≤80 c/u
    "palabras_evitar": ["string"],          // ≤40, ≤80 c/u
    "ejemplos_titulares": ["string"],       // ≤12, ≤160 c/u — reales, de piezas de la marca
    "ejemplos_cta": ["string"]              // ≤12, ≤60 c/u
  },

  // CÓMO SE VE
  "visual": {
    "colores": [{ "nombre": "string", "hex": "#RRGGBB", "uso": "string" }],  // ≤16; sin hex válido se descarta
    "tipografias": [{ "nombre": "string", "uso": "string" }],               // ≤8
    "logo": {
      "ancho_min_px": 120,                  // number o null
      "area_seguridad": "string",           // ≤800
      "usos_prohibidos": ["string"]         // ≤20
    },
    "estilo_fotografico": "string"          // ≤600: luz, encuadre, casting, qué evitar
  },

  // QUÉ DICE LA MARCA
  "estrategia": {
    "posicionamiento": "string",            // cómo quiere ser percibida, 1-2 frases (≤600)
    "publico_objetivo": "string",           // a quién le habla (≤600)
    "propuesta_valor": "string",            // por qué elegirla (≤400)
    "mensajes_clave": ["string"],           // ideas que la marca repite (≤12, ≤200 c/u)
    "productos": [                          // ≤20; sin nombre se descarta
      { "nombre": "string", "descripcion": "string" }   // descripción = beneficio principal (≤200)
    ],
    "campanas_vigentes": ["string"]         // campaña activa + su mensaje + vigencia (≤10, ≤300 c/u)
  },

  // QUÉ RINDE (MÉTRICAS)
  "desempeno": {
    "periodo": "string",                    // período considerado (≤120)
    "aprendizajes": ["string"],             // conclusiones accionables (≤15, ≤300 c/u)
    "mensajes_destacados": [{ "texto": "string", "resultado": "string" }],  // ≤10
    "mensajes_a_evitar":   [{ "texto": "string", "resultado": "string" }],  // ≤10
    "ctas_destacados":     [{ "texto": "string", "resultado": "string" }],  // ≤10
    "formatos_destacados": [{ "formato": "300x250", "canal": "string", "resultado": "string" }],  // ≤10
    "estilos_visuales": ["string"]          // estilo que rinde + su métrica (≤10, ≤300 c/u)
  },

  // QUÉ NO SE PUEDE
  "legales": {
    "textos_obligatorios": ["string"],      // legales que deben ir en las piezas (≤10, ≤400 c/u)
    "restricciones": ["string"]             // claims o palabras prohibidas (≤20, ≤300 c/u)
  },
  "reglas": ["string"],                     // do's & don'ts de marca, una por ítem (≤40, ≤300 c/u)

  "fuentes": ["string"]                     // documentos, tools o reportes consultados (≤20)
}
```

**Válida si** trae al menos uno de: `voz.tono`, `reglas`, `visual.colores`,
`voz.palabras_usar`, `estrategia.posicionamiento` o `desempeno.aprendizajes`.

**Cómo lo usa nanano:**
- `marca` y `productos[].nombre` se escriben tal cual en las piezas.
- `estrategia` decide **qué** se dice; `voz` decide **cómo**.
- `desempeno`: la IA prioriza los mensajes, CTA y estilos que rinden y no
  repite los de `mensajes_a_evitar`. Los aprendizajes se ven en la ficha del
  cliente.
- `legales`: nunca usa un claim prohibido. Si la plantilla tiene un slot de
  letra chica, pone ahí el texto obligatorio.
- `visual`: colores y fuentes cuando la pieza no tiene brand kit propio; el
  logo y las reglas son restricciones. El logo como archivo sale del brand kit
  de nanano, no de acá.
- `fuentes` no va al modelo: es trazabilidad.

**Qué buscar en las métricas** (si existen):
- **Mensajes:** qué ángulo rinde (precio, beneficio, urgencia, novedad,
  emoción) y qué largo de titular.
- **CTA:** qué verbos y formulaciones.
- **Formatos y canales:** cuáles rinden mejor (300x250, 728x90, 1080x1920
  stories…).
- **Estilo visual:** foto de producto o lifestyle, personas o no, colores de
  fondo, con o sin precio visible.
- **Lo que no rinde:** qué evitar.

---

## 2. `CAMPAIGN_BRIEF` — brief de una pieza (por implementar en nanano)

El productor escribe un pedido corto ("banner día del padre, 30% en
parrillas") y el agente de la marca lo completa con lo que sabe: producto
exacto, precio vigente, condiciones, mensaje que rinde y legales aplicables.
nanano usa la respuesta como brief del planificador.

**Pedido (`message`):**
> Brief para una pieza de la marca "enaco": `<pedido del productor>`. Completa
> con producto, precios, condiciones, mensaje recomendado según la estrategia y
> las métricas, y legales que apliquen.

`promptSuffix`: `{ "operation": "CAMPAIGN_BRIEF", "client_slug": "...",
"pedido": "...", "formatos": ["300x250", "1080x1920"], "fecha": "2026-10-28",
"schema": {...} }`

**Respuesta:**

```jsonc
{
  "objetivo": "string",                     // venta, lanzamiento, awareness, tráfico…
  "mensaje_principal": "string",            // la idea, en una frase
  "producto": {
    "nombre": "string",
    "precio": "string",                     // "$9.990" o ""
    "precio_anterior": "string",
    "descuento": "string",                  // "30%" o ""
    "vigencia": "string",                   // "hasta el 15/11" o ""
    "condiciones": "string"                 // stock, tiendas, medios de pago…
  },
  "textos_sugeridos": {
    "titulares": ["string"],                // 3-5 opciones, ≤40 caracteres idealmente
    "bajadas": ["string"],                  // 2-3 opciones
    "ctas": ["string"]                      // 2-3 opciones, 1 a 3 palabras
  },
  "por_que": ["string"],                    // respaldo de los textos en estrategia o métricas (con evidencia)
  "publico": "string",
  "legales": ["string"],                    // legales que aplican a ESTA pieza
  "direccion_visual": "string",             // foto o estilo sugerido según la marca y lo que rinde
  "advertencias": ["string"]                // ej. "el precio no está confirmado en el sistema"
}
```

Si el pedido contradice reglas de la marca o legales (por ejemplo, un claim
prohibido), el agente lo dice en `advertencias` y propone una alternativa.

---

## 3. `COPY_REVIEW` — revisión de textos (por implementar en nanano)

Antes de exportar, nanano manda los textos de la pieza para que la marca los
valide.

**Pedido:** `promptSuffix`: `{ "operation": "COPY_REVIEW", "client_slug":
"...", "textos": [{ "id": "headline", "rol": "titular", "texto": "..." }, ...],
"schema": {...} }`

**Respuesta:**

```jsonc
{
  "aprobado": true,
  "observaciones": [
    {
      "id": "headline",                     // id del texto revisado
      "problema": "string",                 // tono, claim prohibido, nombre mal escrito, precio distinto al vigente…
      "gravedad": "bloqueante | sugerencia",
      "sugerencia": "string"                // texto corregido
    }
  ]
}
```

`aprobado` es `false` si hay al menos una observación `bloqueante`.

---

## Errores (todas las operaciones)

Si no se puede responder, devolver solo:

```json
{ "error": "client_not_found", "client_slug": "<slug>" }
```

Todos llegan con HTTP 200, `status: "completed"` y el error dentro de
`response`. Los resuelve Practicante sin llamar al modelo, así que no tienen
costo.

| Código | Cuándo | Qué muestra nanano |
|---|---|---|
| `client_not_found` | No hay cliente con ese slug | "Practicante no tiene un cliente con ese slug" |
| `no_brand_material` | El cliente no tiene agente activo o el agente no encontró material | "El cliente no tiene un agente activo o material de marca…" |
| `agent_forbidden` | El usuario de `X-User-Email` no tiene permiso sobre el agente | "El usuario de la integración no tiene acceso… (se da el permiso en practicante → usuarios)" |

Errores del llamado en sí (HTTP distinto de 200):
- `401` / `403`: API key o usuario bloqueado.
- `429 cost_limit`: el usuario llegó a su tope de costo.
- `500 execution_error`.

nanano los muestra como "Practicante respondió <código>".

Slugs con agente activo en producción (2026-10-28): `agrosuper`,
`banco-falabella`, `cmr-loyalty`, `enaco`, `grupo-marina`, `lipigas`,
`mall-marina`, `mall-curico`, `mall-concepcion`, `meds`, `mora-pavic`. Con
agente inactivo, y por lo tanto `no_brand_material`: `dreams`, `mitta`, `smu`,
`teleton`.

## Checklist del lado de Practicante

- [x] Derivar los pedidos de nanano al agente del cliente según `client_slug`.
- [ ] Que cada agente de cliente responda `BRAND_GUIDE` con el schema de
      arriba, incluyendo `estrategia`, `desempeno` (con evidencia) y `legales`.
- [ ] Confirmar que `Client.slug` coincide con el slug de la ficha del cliente
      en nanano.
- [ ] Probar con `enaco` y re-sincronizar desde nanano (ficha del cliente →
      Brand Kits → Sincronizar).
- [ ] (Siguiente) Responder `CAMPAIGN_BRIEF` y `COPY_REVIEW`.
- [ ] Borrar el agente "Banner Designer".
