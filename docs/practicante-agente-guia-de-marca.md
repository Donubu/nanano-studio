# Practicante · Agente "Guía de marca" (para nanano)

Especificación de lo que Practicante debe hacer para nanano (Puerto Studio).
nanano ya **no** le pide a Practicante armar, adaptar ni animar banners: todo
eso lo hace nanano con Gemini. Practicante queda solo como **fuente del
conocimiento de marca** (brandbook, voz, normas gráficas) por cliente.

## Recomendación: editar un agente existente, no crear uno nuevo

Reutiliza el agente **"Banner Designer"**, que nanano ya no usa:

- renómbralo a **`brand-guide`** (nombre visible: "Guía de marca"),
- reemplaza su system prompt por el de la sección "System prompt" de abajo,
- dale acceso a las tools de marca del cliente (`brandbook_<slug>` y la base
  de conocimiento del cliente: estrategia, productos, campañas),
- quítale todo lo de diseño de piezas (layouts, keyframes, formatos).

Así no queda un agente huérfano y nanano puede llamarlo por nombre.

## Cómo lo llama nanano

Hoy nanano llama a `POST /api/external/run` **sin `agentName`**, así que
responde el orquestador. Cuando el agente esté listo, nanano pasa a llamarlo
por nombre (es un cambio de una línea en `lib/production/brand-guide.ts` /
`app/api/clients/[id]/brand-guide/route.ts`):

```json
{
  "message": "Necesito la guía de marca completa del cliente con slug \"enaco\" para diseñar banners. ...",
  "dryRun": false,
  "normalize": false,
  "returnOnlyFinalText": true,
  "context": {
    "responseFormat": "json",
    "agentName": "brand-guide",
    "forceAgent": true,
    "promptSuffix": "{\"operation\":\"BRAND_GUIDE\",\"client_slug\":\"enaco\",\"instructions\":[...],\"schema\":{...}}"
  }
}
```

Headers: `X-API-Key` y `X-User-Email`. Esto ya funciona hoy.

- **Llave del cliente:** `client_slug`, el mismo slug que usa Practicante en
  `Client.slug`. Los nombres de cliente no coinciden entre plataformas; el
  slug sí.
- **Cuándo se llama:** solo cuando alguien aprieta "Sincronizar" en la ficha
  del cliente (Brand Kits). Nunca durante una generación. nanano guarda el
  resultado como snapshot.
- **Qué lee nanano:** solo el texto final (`response`), con el JSON de abajo.
  Tolera fences de markdown o texto alrededor, pero lo ideal es JSON puro.

## Contrato de respuesta

Un único objeto JSON con esta forma exacta. Los tipos y topes son los que
aplica nanano al leerlo: lo que pase el tope se recorta y lo inválido se
descarta.

```jsonc
{
  "marca": "string",                      // nombre EXACTO de la marca, tal como se escribe (≤120)
  "voz": {
    "tono": "string",                     // 1-2 frases (≤600)
    "personalidad": ["adjetivo"],         // ≤12, cada uno ≤60
    "tratamiento": "tú | usted | voseo | otro",  // cómo le habla la marca al público (≤300)
    "palabras_usar": ["string"],          // ≤40, cada una ≤80
    "palabras_evitar": ["string"],        // ≤40, cada una ≤80
    "ejemplos_titulares": ["string"],     // ≤12, cada uno ≤160 — reales del material si existen
    "ejemplos_cta": ["string"]            // ≤12, cada uno ≤60
  },
  "visual": {
    "colores": [                          // ≤16; solo entran los que tienen hex válido
      { "nombre": "string", "hex": "#RRGGBB", "uso": "string" }
    ],
    "tipografias": [                      // ≤8
      { "nombre": "string", "uso": "string" }
    ],
    "logo": {
      "ancho_min_px": 120,                // number o null si el brandbook no lo dice
      "area_seguridad": "string",         // ≤800
      "usos_prohibidos": ["string"]       // ≤20
    },
    "estilo_fotografico": "string"        // ≤600
  },
  "reglas": ["string"],                   // do's & don'ts, una por ítem (≤40, cada una ≤300)
  "fuentes": ["string"]                   // documentos o tools consultados (≤20)
}
```

**Cuándo nanano lo da por válido:** si trae al menos `voz.tono`, `reglas`,
`visual.colores` o `voz.palabras_usar`. Si viene todo vacío, la
sincronización falla y nanano muestra el error.

### Cómo lo usa nanano

- `marca` se escribe literal en las piezas: un typo acá ("ENCO" por "ENACO")
  termina en el banner.
- `voz`, `tratamiento`, `palabras_*` y los ejemplos guían los textos que
  escribe la IA (titulares, bajadas, CTA) en español de Chile.
- `colores` y `tipografias` guían la elección de colores y fuentes cuando
  la pieza no tiene brand kit propio.
- `logo` y `reglas` son restricciones que la IA respeta al componer.
- `fuentes` no va al modelo: queda como trazabilidad.

## System prompt sugerido

```text
Eres el agente "Guía de marca". Tu único trabajo es entregar, para un cliente
identificado por su slug, un resumen fiel de su marca listo para que otra IA
diseñe piezas digitales (banners, redes, display).

Cómo trabajar:
1. Identifica al cliente por "client_slug". Usa sus tools de marca
   (brandbook_<slug>) y su base de conocimiento: brandbook, manual de voz,
   estrategia, productos, campañas vigentes.
2. Extrae solo lo que sirve para diseñar y escribir piezas: tono, tratamiento,
   vocabulario, ejemplos reales de titulares y CTA, colores con hex, tipografías,
   reglas de logo (tamaño mínimo, área de seguridad, usos prohibidos), estilo
   fotográfico y do's & don'ts.
3. No inventes. Si un dato no está en el material de la marca, déjalo vacío
   ("" o []) o null en ancho_min_px. No completes con "buenas prácticas" genéricas.
4. "marca" va escrita exactamente como la escribe la marca (mayúsculas,
   tildes, signos).
5. Colores siempre en hex #RRGGBB. Si el brandbook da Pantone/CMYK/RGB,
   conviértelo a hex y anota el original en "uso".
6. "tratamiento": tú, usted, voseo u otro, según cómo le habla la marca a su
   público.
7. Reglas cortas y accionables, una por ítem ("No usar el logo sobre fondos
   rojos", "El precio siempre con signo $ y punto de miles").
8. En "fuentes" lista los documentos o tools que consultaste.

Responde SOLO con el objeto JSON del schema que viene en el pedido
(promptSuffix.schema), sin markdown ni texto adicional.

Fuera de alcance: no diseñes banners, no propongas layouts, formatos,
animaciones ni keyframes, y no generes imágenes. Si te piden algo de eso,
responde igual solo con la guía de marca.
```

## Errores

Si el slug no existe o el cliente no tiene material de marca, responde:

```json
{ "error": "client_not_found", "client_slug": "<slug>" }
```

o `"error": "no_brand_material"`. Hoy nanano lo trata como una guía vacía y
muestra "no se pudo sincronizar". Cuando el agente esté listo, nanano
mostrará estos códigos con su mensaje.

## Checklist del lado de Practicante

- [ ] Renombrar "Banner Designer" a `brand-guide` (o crear `brand-guide` y
      borrar "Banner Designer").
- [ ] System prompt nuevo (arriba) y tools `brandbook_<slug>` + base de
      conocimiento del cliente.
- [ ] Confirmar que `Client.slug` coincide con el slug cargado en nanano
      (ficha del cliente → campo Slug).
- [ ] Probar con `enaco`: la respuesta debe parsear con el schema de arriba.
- [ ] Avisar a nanano para pasar a `agentName: "brand-guide"`.
