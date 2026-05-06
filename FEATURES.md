# PUERTO STUDIO — Catálogo Completo de Funcionalidades

Plataforma centralizada de generación de contenido IA para la agencia de publicidad PUERTO.

---

## 0. DESCRIPCIÓN GENERAL

**Puerto Studio** es la plataforma interna de PUERTO para generar, organizar y monetizar contenido creativo asistido por inteligencia artificial. Concentra en una sola herramienta web la generación de **texto, imágenes, video, audio y música** con los mejores modelos del mercado (Google Gemini/Imagen/VEO/Lyria/Chirp 3 HD, xAI Grok, Kling), eliminando la necesidad de saltar entre múltiples productos comerciales.

La plataforma está diseñada bajo tres ejes:

1. **Producción creativa**: chat IA conversacional, generación multimedia con parámetros profesionales, post-procesamiento (Topaz Studio) y un **Canvas visual basado en nodos** que permite encadenar generaciones como un flujo de trabajo (estilo ComfyUI / Figma), con colaboración en tiempo real entre miembros del equipo.

2. **Organización y control**: cada generación queda asociada a un **cliente** y un **proyecto**, con permisos granulares por usuario, espacios personales, plantillas reutilizables, sistema de pestañas, galería filtrable, tags, favoritos e historial completo. Todo el contenido se almacena en S3/CloudFront para entrega rápida y descarga sin pérdida.

3. **Visibilidad económica**: cada generación registra su costo real, sincronizado con la facturación de Google Cloud (BigQuery). El dashboard administrativo muestra analytics, rankings, reportes semanales por cliente/usuario exportables a PDF, monitoreo de workers y una **calculadora de presupuestos** con versionado de precios para cotizar proyectos a clientes.

La aplicación está construida en Next.js 16 (App Router) sobre MySQL, con autenticación Google OAuth (NextAuth v5), una cola asíncrona BullMQ + Redis para procesar generaciones, y desplegada en GCP con estrategia **blue-green** de cero downtime. Soporta acceso público compartible vía links firmados y un sitio de marketing integrado en `puerto.studio`.

---

## 1. ACCESO Y AUTENTICACIÓN

- **Inicio de sesión con Google**: Acceso seguro mediante cuenta Google corporativa (OAuth)
- **Roles de usuario**: Dos niveles — **Administrador** (acceso total) y **Usuario** (acceso restringido a sus proyectos y clientes asignados)
- **Cargos/puestos predefinidos**: Director de arte, Director de cuentas, Productor, Redactor, Director creativo, Gerente general, Director general creativo, Creador de contenidos, Ejecutivo de cuentas
- **Control de bloqueo**: Los administradores pueden bloquear/desbloquear usuarios sin eliminarlos
- **Permiso para crear proyectos**: configurable por usuario (no todos los usuarios pueden crear proyectos)
- **PIN gate**: solicita un PIN de seguridad cuando un usuario intenta generar 3 o más imágenes en una misma corrida (protección anti-fuga de costos), con desbloqueo persistente por sesión

---

## 2. ORGANIZACIÓN: CLIENTES Y PROYECTOS

### 2.1 Gestión de Clientes
- Cada cliente representa una marca o cuenta de la agencia
- **Logo personalizado** subido a la nube (S3)
- Visibilidad configurable (ocultar clientes de usuarios no autorizados)
- **Clientes internos**: marcador para diferenciar trabajo interno PUERTO vs. cuentas externas en reportes y analytics
- **Vista de detalle de cliente** con sus proyectos, generaciones y métricas asociadas

### 2.2 Gestión de Proyectos
- Los proyectos agrupan todo el trabajo creativo de una campaña o iniciativa
- **Estados**: Activo, Pausado, Completado, Cancelado
- **Configuración de modelos por proyecto**: qué tipos de generación están habilitados (texto, imagen, video, audio, música, canvas) y qué modelos IA están disponibles para cada tipo
- **Templates de proyecto**: Plantillas reutilizables para configurar nuevos proyectos rápidamente con modelos y tipos de generación preconfigurados
- **Editor de templates** (admin): crear, editar y aplicar templates desde la sección de administración
- **Proyectos ocultos**: posibilidad de ocultar proyectos de usuarios sin permisos
- **Favoritos de proyecto**: marcar proyectos para acceso rápido en la barra lateral
- **Ordenamiento por columnas** en la tabla de administración (cliente, fecha, costo, etc.)

### 2.3 Personal Space (Espacio Personal)
- Cada usuario puede tener su propio **espacio personal** habilitable por admin
- Proyecto privado individual donde el usuario explora y experimenta sin afectar facturación de clientes
- Configuración independiente de modelos disponibles
- Aislado del resto de la organización

### 2.4 Navegación por Clientes y Proyectos
- Selector de cliente en la barra lateral izquierda
- Selector de proyecto dentro del cliente seleccionado
- Persistencia de la última selección entre sesiones (se recuerda al volver)
- URLs virtuales para navegación directa (deep linking) con slug de cliente y proyecto

---

## 3. CONVERSACIONES Y SISTEMA DE PESTAÑAS

### 3.1 Conversaciones
- Cada generación de contenido se organiza dentro de una **conversación**
- Las conversaciones se crean dentro de un proyecto específico
- **Título editable** (doble clic para renombrar)
- **Íconos por tipo**: texto, imagen, video, audio, música, full (modo combinado), canvas
- **Archivado** (papelera): las conversaciones se pueden archivar y restaurar (eliminación suave)
- **Historial completo**: todos los mensajes, generaciones y metadatos se conservan
- **Visibilidad pública compartida**: las conversaciones son visibles en tiempo real para los miembros del proyecto (presencia compartida)

### 3.2 Sistema de Pestañas
- Hasta **10 pestañas simultáneas** para trabajar en múltiples conversaciones a la vez
- Pestañas con código de color: azul (normal), púrpura (galería), naranja (archivada), violeta (canvas)
- Cerrar, renombrar y cambiar entre pestañas fluidamente

### 3.3 Modo Full (Studio combinado)
- Modo unificado donde texto, imagen y video conviven en la misma conversación
- Permite alternar entre formatos de generación sin salir del hilo
- Paginación en mensajes para conversaciones largas

---

## 4. GENERACIÓN DE CONTENIDO IA

### 4.1 Generación de Texto (Chat IA)
- **Streaming en tiempo real** (SSE): las respuestas aparecen palabra por palabra
- **Modelos de texto**: Google Gemini (múltiples versiones, incluyendo Gemini 3 Pro)
- **Parámetros configurables**:
  - Instrucción de sistema (personalidad/contexto del asistente)
  - Temperatura (creatividad vs. precisión)
  - Top P, Top K, máximo de tokens
- **Razonamiento (thinking)**: modelos compatibles muestran su cadena de pensamiento antes de la respuesta final
- **Entrada multimodal**: adjuntar imágenes, PDFs, audio o video al mensaje para que el modelo los analice
- **Google Search (Grounding)**: el modelo puede buscar en internet para respuestas actualizadas, con enlaces a las fuentes
- **Opción "Sin contexto"**: enviar un mensaje aislado sin el historial previo de la conversación
- **Renderizado Markdown**: respuestas formateadas con negritas, listas, bloques de código, tablas, etc.
- **Reuso de prompt desde selección de texto**: seleccionar texto en una respuesta y reutilizarlo como prompt para una nueva generación
- **Ignorar mensajes en contexto**: marcador para excluir mensajes específicos del historial enviado al modelo

### 4.2 Generación de Imágenes
- **Modelos disponibles**: Google Imagen 4, Gemini "nano banana" (image-out nativo), xAI Grok Imagine, Kling
- **Relaciones de aspecto**: 1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3
- **Resoluciones**: 1K (1024px), 2K (2048px), 4K (4096px)
- **Múltiples imágenes por prompt**: hasta 4 (Imagen), 10 (Grok), 9 (Kling)
- **Prompt negativo**: describir qué NO debe aparecer en la imagen
- **Imágenes de referencia**: subir hasta **14 imágenes de referencia** para guiar la generación
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
- **Slots VEO**: gestión automática de cuota RPM (libera slots después de la ventana de 60 segundos)

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
- **Tipo `audio_hd`**: filtros y ícono dedicado para distinguir audio de alta calidad

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

## 5. CANVAS — WORKSPACE VISUAL BASADO EN NODOS

Editor de flujos creativos donde cada generación es un **nodo** que puede conectarse con otros para construir pipelines complejos (estilo ComfyUI / n8n / Figma).

### 5.1 Tipos de Nodos
- **Nodos de generación IA**:
  - **Texto**: chat IA con todos los parámetros del modo conversación
  - **Practicante**: nodo de agente externo (ver sección 5.6)
  - **Imagen**: generación de imágenes con cualquier modelo configurado
  - **Video**: generación de video
- **Nodos estáticos** (sin IA):
  - **Nota** (sticky note): anotaciones libres en el lienzo
  - **Texto estático**: bloque de texto fijo reutilizable
  - **Imagen estática**: imagen subida por el usuario, persistida en GCS preservando aspect ratio
  - **Galería** (grupo de imágenes estáticas): conjunto de imágenes para usar como referencias
- **Nodos de parámetros (presets)**:
  - **Params Texto / Imagen / Video**: nodos que encapsulan un set de parámetros (modelo, temperatura, aspect ratio, etc.) y se conectan a múltiples nodos de generación, permitiendo cambiar parámetros en cascada

### 5.2 Conexiones y Ejecución
- **Aristas etiquetadas** entre nodos (input/output tipados)
- **Reglas de conexión**: solo se permiten enlaces compatibles entre tipos
- **Run All**: ejecuta el grafo completo respetando dependencias (orden topológico)
- **Ejecución parcial**: correr un nodo individual y propagar hacia abajo
- **Progreso en tiempo real** con indicador visual por nodo (idle, running, success, error)
- **Estado de ejecución** persistido en la base (`canvas_executions`) para auditoría

### 5.3 Edición y Productividad
- **Auto-save**: el lienzo se guarda automáticamente al editar
- **Undo / Redo**: historial de cambios completo
- **Edición inline**: editar prompts y parámetros directamente sobre el nodo sin abrir paneles
- **Panel de configuración** lateral por nodo con todos los parámetros avanzados
- **Bloqueo de nodos**: lock individual o "lock all" para evitar ediciones accidentales
- **Clonado del canvas**: duplicar el lienzo completo en una nueva conversación
- **Navegación por historial de outputs**: cada nodo guarda sus generaciones anteriores y permite navegar entre ellas con flechas
- **Dry run**: previsualizar costo y plan de ejecución antes de correr
- **Ícono y filtro dedicados** en galería y dashboard para conversaciones de tipo canvas

### 5.4 Colaboración en Tiempo Real
- **WebSockets** (socket.io) para sincronización entre usuarios viendo el mismo canvas
- **Cursores en vivo** con nombre y color por usuario
- **Presence bar**: avatares de quién está activo en el lienzo
- **Connector ghost**: mientras un usuario está creando una conexión, los demás ven el cable preview
- **Edición simultánea** de nodos (los cambios de un usuario se reflejan instantáneamente en los demás)
- **Autenticación basada en sesión** del cliente para conexiones seguras

### 5.5 Galería Multi-Selección
- Selección múltiple de imágenes en la galería para arrastrar al canvas como grupo
- Conversión rápida de selección a nodo "Galería"

### 5.6 Practicante (Agente Externo)
- Nodo dedicado para invocar un servicio externo de **agentes IA personalizados** (Practicante)
- **Catálogo de agentes** disponible mediante proxy autenticado por API key
- **Configuración por nodo**: selección de agente, parámetros del agente, prompt
- Salida streaming compatible con el resto del canvas
- Permite encadenar agentes con otros nodos (texto, imagen, video) en un mismo flujo

---

## 6. INTERACCIÓN CON CONTENIDO GENERADO

### 6.1 Imágenes
- **Vista ampliada** (zoom): modal a pantalla completa
- **Descarga directa** del archivo original
- **Upscale 2x**: botón rápido para duplicar resolución (solo si ≤1920px)
- **Arrastrar imágenes**: drag & drop para reutilizar como referencia
- **Selección como asset**: marcar para usar en próximas generaciones
- **Metadatos visibles**: dimensiones, aspecto, formato, peso

### 6.2 Videos
- **Reproductor de video** integrado con controles
- **Vista ampliada** en modal
- **Selección como asset** para reutilizar
- **Información**: duración, audio

### 6.3 Audio
- **Reproductor de audio** integrado
- **Información de voz**: nombre de la voz y hablante configurado
- **Duración** visible

### 6.4 Música
- **Reproductor de música** dedicado
- **Modo preview**: Guardar / Descartar / Regenerar antes de confirmar

### 6.5 Funciones Transversales
- **Favoritos** (estrella): marcar cualquier generación como favorita
- **Reutilizar prompt**: restaurar el prompt original + imágenes de referencia para iterar
- **Copiar semilla (seed)**: reproducir resultados similares en futuras generaciones
- **Ignorar en contexto**: excluir mensajes específicos del historial que el IA considera
- **Etiquetas (tags)**: sistema de tags con colores personalizados para organizar generaciones
- **Errores expandibles**: los errores muestran detalles técnicos en formato colapsable
- **Reintentos automáticos**: errores transitorios (504, 429, network) se reintentan con backoff exponencial

---

## 7. GALERÍA DE GENERACIONES

- **Acceso**: botón "Ver todas las generaciones" en la barra lateral
- **Filtros combinables**:
  - Por tipo: Todas, Imágenes, Videos, Audios, Música, Audio HD, Texto, Canvas, Full
  - Solo favoritos
  - Por etiquetas (tags)
  - Búsqueda por texto del prompt o título de conversación
  - Incluir/excluir eliminados
  - Incluir/excluir archivos subidos por usuario
- **Dos vistas**:
  - **Cuadrícula (Grid)**: tarjetas con miniaturas responsivas
  - **Calendario**: generaciones agrupadas por fecha
- **Paginación del lado del cliente** para colecciones grandes
- **Multi-selección**: seleccionar varias generaciones para acciones por lote o arrastre al canvas
- **Acciones por generación**: ver, descargar, eliminar, favorito, copiar seed, gestionar tags, reusar prompt
- **Metadatos en cada tarjeta**: tipo, conversación, usuario, modelo, calidad, seed, fecha, tamaño

---

## 8. TOPAZ STUDIO — POST-PROCESAMIENTO IA

### 8.1 Topaz Studio para Imágenes
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

### 8.2 Topaz Studio para Videos
- **Modelos**: auto-enhance, deinterlace, interpolación de movimiento, interpolación de fotogramas
- **Carga por chunks**: subida de video por partes para archivos grandes
- **Seguimiento de estado**: progreso del procesamiento en tiempo real
- **Estimación de créditos** previa

---

## 9. ADJUNTAR ARCHIVOS Y ENTRADA MULTIMEDIA

- **Drag & drop**: arrastrar archivos directamente sobre el área de entrada
- **Click para explorar**: botón de clip para seleccionar archivos
- **Tipos soportados**: imágenes (JPG, PNG, GIF, WebP), documentos (PDF), audio (MP3, WAV, OGG), video (MP4, MOV, WebM)
- **Límite**: hasta **100MB por archivo**, hasta 5-10 archivos simultáneos
- **Previsualizaciones**: miniaturas con nombre y tamaño del archivo
- **Modo assets** (Kling): IDs incrementales (asset1, asset2...) con sistema de @menciones en el prompt
- **Imágenes en modo texto**: el modo de chat de texto soporta hasta 14 imágenes adjuntas
- **Subida optimizada a GCS**: uploads paralelos y compresión inteligente

---

## 10. CALCULADORA IA — PRESUPUESTOS

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
- **Aceptación/rechazo por cliente**: usuarios cliente pueden aprobar o rechazar presupuestos directamente
- **Configuración de precios** (admin): precios base, multiplicadores por add-on, retoque, upscaling
- **Cálculo automático** de costos según configuración vigente

---

## 11. COMPARTIR Y VISTAS PÚBLICAS

### 11.1 Share Links (Conversaciones Públicas)
- Generar **links públicos firmados** para compartir conversaciones con clientes o externos sin requerirles login
- Vista de solo lectura en `/share/[token]`
- Permite a clientes revisar generaciones sin acceso completo a la plataforma

### 11.2 Studio Público (Marketing)
- Sitio web público en `puerto.studio` con material de marketing y showcase
- Páginas integradas a la misma aplicación

---

## 12. DASHBOARD ADMINISTRATIVO

### 12.1 Panel Principal (Stats)
- Tarjetas resumen: usuarios totales, proyectos activos, conversaciones, imágenes/videos/música/audio generados
- Modelos activos/totales
- Costo total estimado (USD)
- Créditos Topaz consumidos (imagen + video)
- Tokens totales (entrada/salida)
- Presupuestos: total, aprobados, pendientes
- Carga optimizada con queries en paralelo (Promise.all)

### 12.2 Estadísticas (Analytics)
- **Períodos**: 7 días, 30 días, 90 días, Todo el tiempo, **rango de fechas personalizado**
- **Gráficos interactivos**:
  - Uso de tokens por día (área apilada)
  - Costos diarios (barras)
  - Generaciones por día y tipo (barras apiladas)
  - Distribución por tipo de generación (torta)
  - **Desglose por resolución de imagen**
- **Rankings**: Top modelos por costo, Top usuarios por uso, Top proyectos (lista completa, no solo top 5)
- **Resúmenes**: tokens, costos, generaciones por tipo, créditos Topaz

### 12.3 Reporte Semanal por Cliente y Usuario
- Tabla cruzada **clientes × usuarios** con costos y conteo de piezas por celda
- **Conteo de piezas** con íconos por tipo (imagen, video, audio, etc.) en cada celda
- Filtro por rango de fechas
- **Exportable a PDF** con formato listo para entregar/facturar
- Útil para cierre mensual y reportes a finanzas

### 12.4 Navegador de Conversaciones
- Búsqueda por título
- Filtros: tipo, proyecto, cliente, usuario, incluir eliminadas
- Tabla paginada con: título, tipo, proyecto, cliente, usuario, mensajes, costo, fecha
- Acciones: previsualizar assets, mover a otro proyecto, eliminar

### 12.5 Historial de Generaciones
- Búsqueda por contenido del prompt
- Filtros: tipo (imagen/video/audio/música/texto/topaz/canvas), proyecto, cliente
- Detalle: modelo usado, usuario, calidad, tokens, costo, archivo, dimensiones, duración
- Totales acumulados por tipo
- Paginación optimizada para conversaciones grandes

### 12.6 Administración de Modelos IA
- Crear, editar, activar/desactivar modelos
- Configurar capacidades: entrada de imágenes/audio/video, generación de imágenes/video/audio, imágenes de referencia, Google Search
- Estructura de costos: precio por millón de tokens (entrada/salida), costos por imagen (1K/2K/4K), video por segundo, audio por minuto
- Selección de backend: Vertex AI vs Gemini API
- Marcar modelos como obsoletos con reemplazo

### 12.7 Templates de Proyecto
- Sección dedicada de administración (`/dashboard/templates`)
- Crear, editar y aplicar plantillas con configuración de modelos preconfigurada
- Acelera el alta de proyectos similares

### 12.8 Monitoreo de Workers (Cola de Trabajos)
- Estado en tiempo real (actualización cada 3 segundos)
- Trabajos: en espera, activos, completados, fallidos, retrasados
- Detalle por trabajo: modelo, tipo, usuario, proyecto, tiempo transcurrido
- Errores expandibles para diagnóstico
- Logs estructurados con clasificación de errores (transitorio vs. permanente)

### 12.9 Logs / Docker Logs Viewer
- Visor de logs del sistema (`/dashboard/logs`)
- Acceso a logs de los contenedores Docker desde la interfaz web
- Filtros y búsqueda en logs

### 12.10 Costos GCP (Facturación)
- Sincronización con BigQuery de Google Cloud
- Tarjetas: costo hoy, ayer, mes actual, mes anterior
- Gráfico de tendencia de costos diarios
- Distribución por servicio GCP (Vertex AI, Cloud Storage, BigQuery, Cloud TTS, Gemini API)
- Tabla desglosada con porcentaje del total
- **Filtro por rango de fechas**
- Corrección de offset de zona horaria (America/Santiago)

### 12.11 Settings — Finanzas
- Sección de configuración financiera (`/dashboard/settings/finance`)
- Parámetros globales que alimentan la calculadora y los reportes

### 12.12 Changelog (Notas de Versión)
- Editor de texto enriquecido (TipTap) con formato
- Versionado semántico
- Vista previa antes de publicar
- Contador de visualizaciones

---

## 13. VENTAJAS CLAVE DE LA PLATAFORMA

### 13.1 Centralización
- **Un solo lugar** para generar texto, imágenes, videos, audio, música y flujos visuales con IA
- **Organización por cliente y proyecto**: todo el contenido generado queda asociado a la campaña correspondiente
- **Historial completo**: cada generación se preserva con su prompt, parámetros, modelo y costo
- **Acceso controlado**: cada usuario ve solo los proyectos y clientes que le corresponden
- **Espacios personales** para experimentación sin afectar facturación de clientes

### 13.2 Mix de Modelos Generativos
- **Múltiples proveedores**: Google (Gemini, Imagen 4, VEO, Lyria, Chirp 3 HD, "nano banana"), xAI (Grok), Kling, agentes externos (Practicante)
- **Selección flexible por proyecto**: el administrador configura qué modelos están disponibles para cada proyecto
- **Calidad Normal vs HQ**: dos niveles de calidad con modelos diferentes para optimizar costos
- **Evolución continua**: nuevos modelos se agregan sin cambiar la experiencia del usuario

### 13.3 Almacenamiento en la Nube (S3 + CloudFront)
- **Todo el contenido generado se almacena automáticamente** en Amazon S3
- **Entrega rápida** vía CDN (CloudFront) desde ubicaciones cercanas al usuario
- **Descargas directas**: cualquier generación puede descargarse en su formato original
- **Sin pérdida de trabajo**: las generaciones persisten independientemente de la sesión

### 13.4 Control de Costos
- **Seguimiento de costos** por generación, por proyecto, por usuario y por modelo
- **Reporte semanal cliente × usuario** exportable a PDF para cierre y facturación
- **Calculadora de presupuestos** para cotizar proyectos antes de ejecutarlos
- **Sincronización con facturación GCP** para control financiero real
- **Analytics detallados**: gráficos y rankings para entender dónde se invierte el presupuesto
- **PIN gate** anti-fuga para generaciones de alto volumen

### 13.5 Productividad
- **Sistema de pestañas**: trabajar en múltiples conversaciones simultáneamente
- **Canvas visual**: encadenar generaciones como pipelines reutilizables (estilo ComfyUI)
- **Reutilización de prompts y seeds**: iterar rápidamente sobre resultados
- **Post-procesamiento integrado** (Topaz Studio): mejorar imágenes y videos sin salir de la plataforma
- **TTS Composer**: crear audio profesional con múltiples voces y control granular
- **Galería con filtros**: encontrar rápidamente cualquier generación pasada
- **Tags y favoritos**: organizar y marcar el mejor contenido
- **Templates de proyecto**: configuración rápida de proyectos nuevos

### 13.6 Colaboración
- **Múltiples usuarios por proyecto**
- **Visibilidad compartida** de generaciones dentro del proyecto en tiempo real
- **Canvas colaborativo** con cursores en vivo y edición simultánea (WebSockets)
- **Share links públicos** para compartir trabajos con clientes sin login
- **Dashboard de analytics** para supervisores y directores
- **Changelog integrado**: el equipo se entera de nuevas funcionalidades automáticamente

### 13.7 Robustez Operacional
- **Despliegue blue-green** con cero downtime en producción (puerto.studio)
- **Cola asíncrona** (BullMQ + Redis) para procesar generaciones largas sin bloquear la UI
- **Reintentos automáticos** con backoff exponencial ante errores transitorios
- **SSL automatizado** (Let's Encrypt)
- **Headers de seguridad** y TLS hardening en nginx
- **Tests automatizados** (Vitest) sobre módulos críticos
- **Validación con Zod** en endpoints de API
- **Logs estructurados** con clasificación de errores para diagnóstico rápido
