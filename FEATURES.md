# PUERTO STUDIO — Catálogo Completo de Funcionalidades

Plataforma centralizada de generación de contenido IA para la agencia de publicidad PUERTO.

---

## 1. ACCESO Y AUTENTICACIÓN

- **Inicio de sesión con Google**: Acceso seguro mediante cuenta Google corporativa (OAuth)
- **Roles de usuario**: Dos niveles — **Administrador** (acceso total) y **Usuario** (acceso restringido a sus proyectos y clientes asignados)
- **Cargos/puestos predefinidos**: Director de arte, Director de cuentas, Productor, Redactor, Director creativo, Gerente general, Director general creativo, Creador de contenidos, Ejecutivo de cuentas
- **Control de bloqueo**: Los administradores pueden bloquear/desbloquear usuarios sin eliminarlos

---

## 2. ORGANIZACIÓN: CLIENTES Y PROYECTOS

### 2.1 Gestión de Clientes
- Cada cliente representa una marca o cuenta de la agencia
- **Logo personalizado** subido a la nube (S3)
- Visibilidad configurable (ocultar clientes de usuarios no autorizados)

### 2.2 Gestión de Proyectos
- Los proyectos agrupan todo el trabajo creativo de una campaña o iniciativa
- **Estados**: Activo, Pausado, Completado, Cancelado
- **Configuración de modelos por proyecto**: qué tipos de generación están habilitados (texto, imagen, video, audio, música) y qué modelos IA están disponibles para cada tipo
- **Templates de proyecto**: Plantillas reutilizables para configurar nuevos proyectos rápidamente con modelos y tipos de generación preconfigurados
- **Proyectos ocultos**: posibilidad de ocultar proyectos de usuarios sin permisos

### 2.3 Navegación por Clientes y Proyectos
- Selector de cliente en la barra lateral izquierda
- Selector de proyecto dentro del cliente seleccionado
- Persistencia de la última selección entre sesiones (se recuerda al volver)
- URLs virtuales para navegación directa (deep linking)

---

## 3. CONVERSACIONES Y SISTEMA DE PESTAÑAS

### 3.1 Conversaciones
- Cada generación de contenido se organiza dentro de una **conversación**
- Las conversaciones se crean dentro de un proyecto específico
- **Título editable** (doble clic para renombrar)
- **Íconos por tipo**: texto, imagen, video, audio, música
- **Archivado** (papelera): las conversaciones se pueden archivar y restaurar (eliminación suave)
- **Historial completo**: todos los mensajes, generaciones y metadatos se conservan

### 3.2 Sistema de Pestañas
- Hasta **10 pestañas simultáneas** para trabajar en múltiples conversaciones a la vez
- Pestañas con código de color: azul (normal), púrpura (galería), naranja (archivada)
- Cerrar, renombrar y cambiar entre pestañas fluidamente

---

## 4. GENERACIÓN DE CONTENIDO IA

### 4.1 Generación de Texto (Chat IA)
- **Streaming en tiempo real** (SSE): las respuestas aparecen palabra por palabra
- **Modelos de texto**: Google Gemini (múltiples versiones disponibles)
- **Parámetros configurables**:
  - Instrucción de sistema (personalidad/contexto del asistente)
  - Temperatura (creatividad vs. precisión)
  - Top P, Top K, máximo de tokens
- **Entrada multimodal**: adjuntar imágenes, PDFs, audio o video al mensaje para que el modelo los analice
- **Google Search (Grounding)**: el modelo puede buscar en internet para respuestas actualizadas, con enlaces a las fuentes
- **Opción "Sin contexto"**: enviar un mensaje aislado sin el historial previo de la conversación
- **Renderizado Markdown**: respuestas formateadas con negritas, listas, bloques de código, tablas, etc.

### 4.2 Generación de Imágenes
- **Modelos disponibles**: Google Imagen 4, xAI Grok Imagine, Kling
- **Relaciones de aspecto**: 1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3
- **Resoluciones**: 1K (1024px), 2K (2048px), 4K (4096px)
- **Múltiples imágenes por prompt**: hasta 4 (Imagen), 10 (Grok), 9 (Kling)
- **Prompt negativo**: describir qué NO debe aparecer en la imagen
- **Imágenes de referencia**: subir imágenes de referencia para guiar la generación
- **Semilla (seed)**: copiar y reutilizar semillas para reproducir resultados similares
- **Metadatos visibles**: dimensiones, relación de aspecto, formato, tamaño de archivo

### 4.3 Generación de Video
- **Proveedores**: Google VEO, xAI Grok Video, Kling v2.6
- **Duraciones**: desde 1 hasta 15 segundos según proveedor
- **Resoluciones**: 480p, 720p, 1080p (según proveedor y duración)
- **Relaciones de aspecto**: 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9
- **Audio nativo**: opción de generar audio integrado en el video (VEO, Kling)
- **Primer/último fotograma**: subir imágenes para definir el inicio y fin del video
- **Prompt negativo**: excluir elementos no deseados
- **Assets con @menciones** (Kling): referenciar imágenes/videos subidos en el prompt usando @asset1, @asset2
- **Voice binding por asset** (Kling): asignar muestras de voz a personajes específicos

### 4.4 Generación de Audio (Text-to-Speech)
- **Dos motores TTS**:
  - **Gemini TTS** (estándar): hasta ~11 minutos, 4,000 bytes
  - **Chirp 3 HD** (alta calidad): hasta 5,000 bytes, 51 idiomas, control de velocidad
- **Selección de voz**: catálogo de voces disponibles
- **Modo multi-locutor** (Gemini): hasta 10 hablantes diferentes en un mismo audio, cada uno con su propia voz
- **Instrucciones de estilo**: tono cálido, entusiasta, misterioso, etc.
- **TTS Composer**: editor visual de segmentos para Chirp 3 HD con control de velocidad y tono por segmento
- **Editor SSML** (Chirp 3 HD): control avanzado de pronunciación, pausas, énfasis
- **Presets de estilo**: plantillas predefinidas para aplicar a todos los segmentos
- **Formatos de salida**: MP3 (comprimido) o WAV (alta calidad sin pérdida)
- **Velocidad de habla**: control granular de 0.25x a 2.0x
- **Selector de idioma**: 51 idiomas disponibles

### 4.5 Generación de Música
- **Motor**: Google Lyria
- **Múltiples prompts ponderados**: hasta 4 descripciones simultáneas, cada una con peso (0.0-1.0)
- **BPM**: 60-200 (tempo configurable)
- **Duración**: 10-120 segundos
- **Escala musical**: selección de escalas (C Mayor, D Menor, etc.)
- **Controles avanzados**:
  - Densidad (escasa a densa)
  - Brillo (oscuro a brillante)
  - Guidance (libre a estricto)
- **Control de instrumentos**: silenciar bajo, silenciar batería, o solo bajo y batería
- **Modo preview**: escuchar antes de guardar, con opciones de guardar, descartar o regenerar
- **Barra de progreso**: porcentaje de avance durante la generación

---

## 5. INTERACCIÓN CON CONTENIDO GENERADO

### 5.1 Imágenes
- **Vista ampliada** (zoom): modal a pantalla completa
- **Descarga directa** del archivo original
- **Upscale 2x**: botón rápido para duplicar resolución (solo si ≤1920px)
- **Arrastrar imágenes**: drag & drop para reutilizar como referencia
- **Selección como asset**: marcar para usar en próximas generaciones
- **Metadatos visibles**: dimensiones, aspecto, formato, peso

### 5.2 Videos
- **Reproductor de video** integrado con controles
- **Vista ampliada** en modal
- **Selección como asset** para reutilizar
- **Información**: duración, audio

### 5.3 Audio
- **Reproductor de audio** integrado
- **Información de voz**: nombre de la voz y hablante configurado
- **Duración** visible

### 5.4 Música
- **Reproductor de música** dedicado
- **Modo preview**: Guardar / Descartar / Regenerar antes de confirmar

### 5.5 Funciones Transversales
- **Favoritos** (estrella): marcar cualquier generación como favorita
- **Reutilizar prompt**: restaurar el prompt original + imágenes de referencia para iterar
- **Copiar semilla (seed)**: reproducir resultados similares en futuras generaciones
- **Ignorar en contexto**: excluir mensajes específicos del historial que el IA considera
- **Etiquetas (tags)**: sistema de tags con colores personalizados para organizar generaciones
- **Errores expandibles**: los errores muestran detalles técnicos en formato colapsable

---

## 6. GALERÍA DE GENERACIONES

- **Acceso**: botón "Ver todas las generaciones" en la barra lateral
- **Filtros combinables**:
  - Por tipo: Todas, Imágenes, Videos, Audios, Música
  - Solo favoritos
  - Por etiquetas (tags)
  - Búsqueda por texto del prompt o título de conversación
  - Incluir/excluir eliminados
  - Incluir/excluir archivos subidos por usuario
- **Dos vistas**:
  - **Cuadrícula (Grid)**: tarjetas con miniaturas responsivas
  - **Calendario**: generaciones agrupadas por fecha
- **Acciones por generación**: ver, descargar, eliminar, favorito, copiar seed, gestionar tags, reusar prompt
- **Metadatos en cada tarjeta**: tipo, conversación, usuario, modelo, calidad, seed, fecha, tamaño

---

## 7. TOPAZ STUDIO — POST-PROCESAMIENTO IA

### 7.1 Topaz Studio para Imágenes
- **Interfaz modal** a pantalla completa
- **Modelos disponibles**:
  - Estándar: Standard V2, Recovery V2 (rápidos)
  - Generativos: Wonder, Redefine (creativos)
- **Escalas**: 2x, 3x, 4x, 5x, 6x
- **Parámetros ajustables** (modelos estándar):
  - Nitidez (Sharpen), Reducción de ruido (Denoise), Detalle, Desenfoque menor, Compresión
- **Parámetros creativos** (modelos generativos):
  - Creatividad (1-6), Textura (1-5)
- **Mejora facial**: toggle con control de intensidad
- **Formatos de salida**: PNG (sin pérdida), JPEG (comprimido), TIFF (profesional)
- **Historial de ediciones**: registro de todas las mejoras aplicadas con resolución, créditos y timestamp
- **Estimación de créditos**: cálculo previo antes de procesar
- **Indicadores verdes**: muestran qué combinaciones modelo+escala ya fueron procesadas

### 7.2 Topaz Studio para Videos
- **Modelos**: auto-enhance, deinterlace, interpolación de movimiento, interpolación de fotogramas
- **Carga por chunks**: subida de video por partes para archivos grandes
- **Seguimiento de estado**: progreso del procesamiento en tiempo real
- **Estimación de créditos** previa

---

## 8. ADJUNTAR ARCHIVOS Y ENTRADA MULTIMEDIA

- **Drag & drop**: arrastrar archivos directamente sobre el área de entrada
- **Click para explorar**: botón de clip para seleccionar archivos
- **Tipos soportados**: imágenes (JPG, PNG, GIF, WebP), documentos (PDF), audio (MP3, WAV, OGG), video (MP4, MOV, WebM)
- **Límite**: 20MB por archivo, hasta 5-10 archivos simultáneos
- **Previsualizaciones**: miniaturas con nombre y tamaño del archivo
- **Modo assets** (Kling): IDs incrementales (asset1, asset2...) con sistema de @menciones en el prompt

---

## 9. CALCULADORA IA — PRESUPUESTOS

- **Acceso**: usuarios con permiso de calculadora habilitado
- **Crear presupuestos** con:
  - Nombre del proyecto y cliente
  - Ítems de video: cantidad de planos, lip sync, entrenamiento, complejidad, adaptaciones
  - Ítems de foto: cantidad de imágenes, retoque (básico/medio/complejo), upscaling, capas
  - Horas asignadas por ítem (equipo/persona)
  - Costos externos por ítem y globales
  - Descuentos con justificación
  - Fee técnico porcentual
- **Estados de presupuesto**: Borrador, Aceptado, Rechazado
- **Configuración de precios** (admin): precios base, multiplicadores por add-on, retoque, upscaling
- **Cálculo automático** de costos según configuración vigente

---

## 10. DASHBOARD ADMINISTRATIVO

### 10.1 Panel Principal (Stats)
- Tarjetas resumen: usuarios totales, proyectos activos, conversaciones, imágenes/videos/música/audio generados
- Modelos activos/totales
- Costo total estimado (USD)
- Créditos Topaz consumidos (imagen + video)
- Tokens totales (entrada/salida)
- Presupuestos: total, aprobados, pendientes

### 10.2 Estadísticas (Analytics)
- **Períodos**: 7 días, 30 días, 90 días, Todo el tiempo
- **Gráficos interactivos**:
  - Uso de tokens por día (área apilada)
  - Costos diarios (barras)
  - Generaciones por día y tipo (barras apiladas)
  - Distribución por tipo de generación (torta)
- **Rankings**: Top 5 modelos por costo, Top 5 usuarios por uso, Top 5 proyectos
- **Resúmenes**: tokens, costos, generaciones por tipo, créditos Topaz

### 10.3 Navegador de Conversaciones
- Búsqueda por título
- Filtros: tipo, proyecto, cliente, usuario, incluir eliminadas
- Tabla paginada con: título, tipo, proyecto, cliente, usuario, mensajes, costo, fecha
- Acciones: previsualizar assets, mover a otro proyecto, eliminar

### 10.4 Historial de Generaciones
- Búsqueda por contenido del prompt
- Filtros: tipo (imagen/video/audio/música/texto/topaz), proyecto, cliente
- Detalle: modelo usado, usuario, calidad, tokens, costo, archivo, dimensiones, duración
- Totales acumulados por tipo

### 10.5 Administración de Modelos IA
- Crear, editar, activar/desactivar modelos
- Configurar capacidades: entrada de imágenes/audio/video, generación de imágenes/video/audio, imágenes de referencia, Google Search
- Estructura de costos: precio por millón de tokens (entrada/salida), costos por imagen (1K/2K/4K), video por segundo, audio por minuto
- Selección de backend: Vertex AI vs Gemini API
- Marcar modelos como obsoletos con reemplazo

### 10.6 Monitoreo de Workers (Cola de Trabajos)
- Estado en tiempo real (actualización cada 3 segundos)
- Trabajos: en espera, activos, completados, fallidos, retrasados
- Detalle por trabajo: modelo, tipo, usuario, proyecto, tiempo transcurrido
- Errores expandibles para diagnóstico

### 10.7 Costos GCP (Facturación)
- Sincronización con BigQuery de Google Cloud
- Tarjetas: costo hoy, ayer, mes actual, mes anterior
- Gráfico de tendencia de costos diarios
- Distribución por servicio GCP (Vertex AI, Cloud Storage, BigQuery, Cloud TTS, Gemini API)
- Tabla desglosada con porcentaje del total

### 10.8 Changelog (Notas de Versión)
- Editor de texto enriquecido (TipTap) con formato
- Versionado semántico
- Vista previa antes de publicar
- Contador de visualizaciones

---

## 11. VENTAJAS CLAVE DE LA PLATAFORMA

### 11.1 Centralización
- **Un solo lugar** para generar texto, imágenes, videos, audio y música con IA
- **Organización por cliente y proyecto**: todo el contenido generado queda asociado a la campaña correspondiente
- **Historial completo**: cada generación se preserva con su prompt, parámetros, modelo y costo
- **Acceso controlado**: cada usuario ve solo los proyectos y clientes que le corresponden

### 11.2 Mix de Modelos Generativos
- **Múltiples proveedores**: Google (Gemini, Imagen 4, VEO, Lyria, Chirp 3 HD), xAI (Grok), Kling
- **Selección flexible por proyecto**: el administrador configura qué modelos están disponibles para cada proyecto
- **Calidad Normal vs HQ**: dos niveles de calidad con modelos diferentes para optimizar costos
- **Evolución continua**: nuevos modelos se agregan sin cambiar la experiencia del usuario

### 11.3 Almacenamiento en la Nube (S3 + CloudFront)
- **Todo el contenido generado se almacena automáticamente** en Amazon S3
- **Entrega rápida** vía CDN (CloudFront) desde ubicaciones cercanas al usuario
- **Descargas directas**: cualquier generación puede descargarse en su formato original
- **Sin pérdida de trabajo**: las generaciones persisten independientemente de la sesión

### 11.4 Control de Costos
- **Seguimiento de costos** por generación, por proyecto, por usuario y por modelo
- **Calculadora de presupuestos** para cotizar proyectos antes de ejecutarlos
- **Sincronización con facturación GCP** para control financiero real
- **Analytics detallados**: gráficos y rankings para entender dónde se invierte el presupuesto

### 11.5 Productividad
- **Sistema de pestañas**: trabajar en múltiples conversaciones simultáneamente
- **Reutilización de prompts y seeds**: iterar rápidamente sobre resultados
- **Post-procesamiento integrado** (Topaz Studio): mejorar imágenes y videos sin salir de la plataforma
- **TTS Composer**: crear audio profesional con múltiples voces y control granular
- **Galería con filtros**: encontrar rápidamente cualquier generación pasada
- **Tags y favoritos**: organizar y marcar el mejor contenido

### 11.6 Colaboración
- **Múltiples usuarios por proyecto**
- **Visibilidad compartida** de generaciones dentro del proyecto
- **Dashboard de analytics** para supervisores y directores
- **Changelog integrado**: el equipo se entera de nuevas funcionalidades automáticamente
