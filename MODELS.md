# Puerto Studio - Technical Model Reference

> Technical reference for all generation models, capabilities, and architecture.
> For UI redesign and implementation planning.
> Last updated: 2026-03-13

---

## Image Generation

### Nano Banana Pro

| Property | Value |
|---|---|
| **Model ID** | `gemini-3-pro-image-preview` |
| **DB ID** | 1 |
| **Backend** | Gemini API |
| **Endpoint** | `/messages/stream/` |
| **Transport** | SSE (inline in text generation) |
| **Worker** | No (direct in API route) |

**Capabilities:**
- Resolutions: 1K, 2K, 4K
- Aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9
- Images per request: 1 (model may return extras based on prompt)
- Parallel generation: Yes (1-4 via `skip_user_message`, limited to 1 image per parallel request)
- Seed: No
- Negative prompt: No
- Reference images: No
- Google Search: No
- Text + Image output: Yes (can return text alongside images)
- Cost: $0.134/image (1K/2K), $0.240/image (4K)

---

### Nano Banana

| Property | Value |
|---|---|
| **Model ID** | `models/gemini-2.5-flash-image` |
| **DB ID** | 2 |
| **Backend** | Vertex AI |
| **Endpoint** | `/messages/stream/` |
| **Transport** | SSE (inline in text generation) |
| **Worker** | No |

**Capabilities:**
- Resolutions: 1K, 2K, 4K
- Aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9
- Images per request: 1
- Parallel generation: Yes (1-4 via `skip_user_message`)
- Seed: No
- Negative prompt: No
- Reference images: No
- Google Search: No
- Text + Image output: Yes
- Cost: $0.040/image (1K/2K), $0.060/image (4K)

---

### Nano Banana 2

| Property | Value |
|---|---|
| **Model ID** | `gemini-3.1-flash-image-preview` |
| **DB ID** | 231 |
| **Backend** | Gemini API |
| **Endpoint** | `/messages/stream/` |
| **Transport** | SSE (inline in text generation) |
| **Worker** | No |

**Capabilities:**
- Resolutions: 1K, 2K, 4K
- Aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9
- Images per request: 1
- Parallel generation: Yes (1-4 via `skip_user_message`)
- Seed: No
- Negative prompt: No
- Reference images: No
- Google Search: Yes (web search + image search grounding)
- Text + Image output: Yes
- Max tokens: 32,768
- Cost: $0.067/image (1K), $0.101/image (2K), $0.151/image (4K)

---

### Gemini 3.1 Pro Preview

| Property | Value |
|---|---|
| **Model ID** | `gemini-3.1-pro-preview` |
| **DB ID** | 230 |
| **Backend** | Gemini API |
| **Endpoint** | `/messages/stream/` |
| **Transport** | SSE (inline in text generation) |
| **Worker** | No |

**Note:** Primarily a text model that also generates images. Multi-modal (text + image + audio + video input).

**Capabilities:**
- Resolutions: 1K, 2K, 4K
- Aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 21:9
- Images per request: 1
- Parallel generation: Yes (1-4)
- Seed: No
- Negative prompt: No
- Thinking/Reasoning: Yes (low, medium, high levels)
- Max tokens: 65,536
- Cost: $2.00/M input, $12.00/M output, $0.134/image (1K/2K), $0.240/image (4K)

---

### Imagen 4 (Fast / Standard / Ultra)

| Property | Fast | Standard | Ultra |
|---|---|---|---|
| **Model ID** | `imagen-4.0-fast-generate-001` | `imagen-4.0-generate-001` | `imagen-4.0-ultra-generate-001` |
| **DB ID** | 30 | 31 | 32 |
| **Cost/image (1K/2K)** | $0.020 | $0.040 | $0.060 |

| Property | Value |
|---|---|
| **Backend** | Vertex AI |
| **Endpoint** | `/messages/imagen/` (dedicated) |
| **Transport** | SSE |
| **Worker** | Yes (BullMQ preferred), direct as fallback |

**Capabilities:**
- Resolutions: 1K, 2K (no 4K)
- Aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9
- Images per request: 1-4 (native `numberOfImages` parameter, single request)
- Parallel generation: N/A (uses native multi-image in single request)
- Seed: Yes (Vertex AI, requires `addWatermark=false`)
- Negative prompt: Yes (Vertex AI only)
- Reference images: No
- Person generation: `allow_all`
- Text output: No (image only)
- Max generation time: 5 minutes

---

### Grok Imagine Image

| Property | Value |
|---|---|
| **Model ID** | `grok-imagine-image` |
| **DB ID** | 234 |
| **Backend** | xAI API |
| **Endpoint** | `/messages/imagen/` (dedicated) |
| **Transport** | SSE |
| **Worker** | Yes (BullMQ preferred), direct as fallback |

**Capabilities:**
- Resolutions: 1K, 2K (no 4K)
- Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, auto
- Images per request: 1-10 (native `n` parameter)
- Parallel generation: N/A (uses native multi-image)
- Seed: No
- Negative prompt: No
- Reference images: Yes (up to 3, uses `/images/edits` endpoint)
- Cost: $0.020/image (1K), $0.040/image (2K)
- API: `https://api.x.ai/v1/images/generations` or `/images/edits`

---

### Kling Omni Image

| Property | Value |
|---|---|
| **Model ID** | `kling-omni-image` |
| **DB ID** | 236 |
| **Backend** | Kling API |
| **Endpoint** | `/messages/imagen/` (dedicated) |
| **Transport** | SSE |
| **Worker** | Yes (BullMQ preferred), direct as fallback |

**Capabilities:**
- Resolutions: 1K, 2K (no 4K)
- Aspect ratios: 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9
- Images per request: 1-9 (native `n` parameter)
- Parallel generation: N/A (uses native multi-image)
- Seed: No
- Negative prompt: No
- Reference images: Yes (via `image_list` array)
- Cost: $0.010/image (1K), $0.020/image (2K)
- Polling: Create task → poll (2s initial, 10s max, 1.5x backoff, 5min timeout)
- Auth: JWT (HS256) via access/secret key pair

---

## Video Generation

### VEO 3.1 HQ

| Property | Value |
|---|---|
| **Model ID** | `veo-3.1-generate-001` (Vertex) / `veo-3.1-generate-preview` (Gemini) |
| **DB ID** | 13 |
| **Backend** | Gemini API |
| **Endpoint** | `/messages/video/` |
| **Transport** | SSE with long-running operation polling |
| **Worker** | No (direct in API route) |

**Capabilities:**
- Durations: 4, 6, 8 seconds (discrete)
- Resolutions: 720p (all durations), 1080p (8s only)
- Aspect ratios: 16:9, 9:16
- Audio generation: Yes (native, configurable)
- First frame: Yes
- Last frame: Yes
- Reference images: Yes, up to 3 (types: ASSET, STYLE)
- Seed: Yes (Vertex AI only, not sent via Gemini API)
- Negative prompt: Yes (Vertex AI only)
- Person generation: `allow_adult` (forced with images on Gemini API)
- Parallel generation: Yes (1-4 via `skip_user_message`)
- Cost: $0.40/second

**Gemini API constraints:**
- Reference images + first/last frame cannot combine (references take priority)
- 1080p, reference images, and interpolation all require 8s duration
- Seed and negative prompt not supported (Gemini API limitation)

**Rate limiting (Redis semaphore):**
- 9 slots per pool
- 2 pools: primary (`GEMINI_API_KEY`) + overflow (`GEMINI_API_KEY_OVERFLOW`)
- Max concurrent: 18 (with overflow), 9 (without)
- Stale timeout: 15 minutes (crash safety, auto-cleanup)
- Queue wait: Up to 5 minutes with progress SSE events
- Routing: primary first, overflow only when primary full

**Polling:**
- Initial delay: 5s (env: `VIDEO_POLLING_INITIAL_DELAY_MS`)
- Max delay: 30s (env: `VIDEO_POLLING_MAX_DELAY_MS`)
- Backoff: 1.5x (env: `VIDEO_POLLING_BACKOFF_MULTIPLIER`)
- Timeout: 15 min (env: `VIDEO_GENERATION_TIMEOUT_MS`)

**Retry:** Max 3 retries, 5s initial → 60s max, 2x backoff. Retriable: 429, 500, 503, resource_exhausted, quota.

---

### VEO 3.1 Fast

| Property | Value |
|---|---|
| **Model ID** | `veo-3.1-fast-generate-001` / `veo-3.1-fast-generate-preview` |
| **DB ID** | 14 |
| **Backend** | Gemini API |
| **Cost** | $0.15/second |

Same capabilities, constraints, rate limiting, and polling as VEO 3.1 HQ.
Shares the same semaphore pool. Faster generation, lower cost.

---

### Grok Imagine Video

| Property | Value |
|---|---|
| **Model ID** | `grok-imagine-video` |
| **DB ID** | 233 |
| **Backend** | xAI API |
| **Endpoint** | `/messages/video/` |
| **Transport** | SSE with REST polling |
| **Worker** | No |

**Capabilities:**
- Durations: 1-15 seconds (continuous range)
- Resolutions: 480p, 720p
- Aspect ratios: 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- Audio generation: No
- First frame: Yes (single image)
- Last frame: No
- Reference images: No
- Seed: No (always returns 0)
- Negative prompt: No
- Parallel generation: No (1 only, no semaphore)
- Cost: $0.05/second

**Polling:** POST → get `request_id` → poll GET until `status=done`. Same timing as VEO.
**Rate limiting:** None explicit (relies on xAI API limits, retry on 429).

---

### Kling v3 Omni Video

| Property | Value |
|---|---|
| **Model ID** | `kling-v3-omni` |
| **DB ID** | 235 |
| **Backend** | Kling API |
| **Endpoint** | `/messages/video/` |
| **Transport** | SSE with REST polling |
| **Worker** | No |

**Capabilities:**
- Durations: 3-15 seconds (continuous range)
- Resolutions: 720p (std mode), 1080p (pro mode)
- Aspect ratios: 16:9, 9:16, 1:1
- Audio generation: Yes (`sound: "on"/"off"`)
- First frame: Yes (`image_list[].type="first_frame"`)
- Last frame: Yes (`image_list[].type="end_frame"`)
- Reference images: Yes, unlimited (via `image_list` array)
- Seed: No
- Negative prompt: Yes
- Inline assets: Yes (`<<<image_N>>>`, `<<<video_N>>>` in prompt)
  - Max 1 video + 7 images (or 4 images if video present)
- Voice bindings: Yes (per-asset voice cloning via `voice_list`, 5-30s audio each)
- Parallel generation: No (1 only)
- Cost: $0.23/second

**Polling:** POST `/v1/videos/omni-video` → poll GET. Same timing.
**Auth:** JWT (HS256), 30-min token validity.

---

### Kling v2.6 Video

| Property | Value |
|---|---|
| **Model ID** | `kling-v2-6` |
| **DB ID** | 237 |
| **Backend** | Kling API |
| **Endpoint** | `/messages/video/` |
| **Transport** | SSE with REST polling |
| **Worker** | No |

**Capabilities:**
- Durations: 5, 10 seconds only (discrete)
- Resolutions: 720p (std), 1080p (pro)
- Aspect ratios: 16:9, 9:16, 1:1
- Audio generation: Yes (pro/1080p mode only, forced off in std/720p)
- First frame: Yes (`image` field)
- Last frame: Yes (`image_tail` field)
- Reference images: No (only frame interpolation)
- Seed: No
- Negative prompt: Yes
- Inline assets: No (v3 feature only)
- Voice bindings: No (v3 feature only)
- Parallel generation: No
- Cost: $0.15/second

**API:** POST `/v1/videos/text2video` (text-only) or `/v1/videos/image2video` (with images).

---

## Audio/TTS Generation

### Gemini TTS (Flash & Pro)

| Property | Flash | Pro |
|---|---|---|
| **Model ID** | `gemini-2.5-flash-preview-tts` | `gemini-2.5-pro-preview-tts` |
| **DB ID** | 23 | 24 |
| **Cost input** | Free | $1.00/M tokens |
| **Cost output** | Free | $20.00/M tokens |

| Property | Value |
|---|---|
| **Backend** | Gemini API |
| **Endpoint** | `/messages/audio/` |
| **Transport** | SSE |
| **Worker** | No |

**Capabilities:**
- Voices: 30 pre-built (see voice list below)
- Multi-speaker: Yes (2-10 speakers, text format: `SpeakerName: text`)
- Style prompt: Yes (text-based: "warm", "enthusiastic", "mysterious", etc.)
- Output formats: MP3, WAV
- Audio specs: PCM16 at 24kHz mono (converted via ffmpeg)
- Text limit: 4,000 bytes
- Speaking rate: Not configurable
- Locale: Not configurable
- Parallel generation: Yes (1-4 via `skip_user_message`)

**Also exists as (DB IDs 6, 17 — same models with `models/` prefix for Vertex-style IDs).**

---

### Chirp 3 HD TTS

| Property | Value |
|---|---|
| **Model ID** | `chirp3-hd` |
| **DB ID** | 229 |
| **Backend** | Google Cloud TTS (separate API, not Gemini) |
| **Endpoint** | `/messages/audio/` |
| **Transport** | SSE |
| **Worker** | No |
| **Cost** | $0.00016/minute |

**Capabilities:**
- Voices: 30 (same names as Gemini, different backend: `{locale}-Chirp3-HD-{VoiceName}`)
- Multi-speaker: No (disabled when Chirp selected)
- Style prompt: No (uses SSML instead)
- SSML support: `<speak>`, `<break>` tags
- Chirp markup: `[pause]`, `[pause short]`, `[pause long]` (auto-converted to SSML)
- Output formats: MP3 (128kbps), OGG_OPUS (96kbps), LINEAR16
- Audio specs: 24kHz
- Text limit: 5,000 bytes (higher than Gemini)
- Speaking rate: 0.25x to 2.0x
- Locales: 51 languages
- Parallel generation: Yes (1-4 via `skip_user_message`)

**Key differences from Gemini TTS:**
- Separate API client (TextToSpeechClient)
- No multi-speaker
- No style prompts (SSML instead)
- Has speaking rate control
- Has locale support (51 languages)
- Higher text limit (5,000 vs 4,000 bytes)

---

### Voice List (30 voices, shared across Gemini TTS and Chirp)

| Voice | Gender | Style |
|---|---|---|
| **Kore** (default) | Female | Firm/Smooth |
| Puck | Male | Bright/Upbeat |
| Zephyr | Neutral | Bright/Upbeat |
| Charon | Male | Informative |
| Fenrir | Male | Distinctive |
| Aoede | Female | Expressive |
| Leda | Female | Bright |
| Orus | Male | Firm |
| Iapetus | Male | Informative |
| Erinome | Female | Informative |
| Algieba | Male | Smooth |
| Autonoe | Female | Bright |
| Callirrhoe | Female | Expressive |
| Umbriel | Neutral | Distinctive |
| Enceladus | Neutral | Unique |
| Despina | Female | Smooth |
| Laomedeia | Female | Bright |
| Rasalgethi | Male | Informative |
| Sadaltager | Male | Informative |
| Alnilam | Male | Firm |
| Algenib | Male | Unique |
| Achernar | Female | Unique |
| Schedar | Female | Unique |
| Gacrux | Male | Unique |
| Pulcherrima | Female | Unique |
| Achird | Male | Unique |
| Zubenelgenubi | Male | Unique |
| Vindemiatrix | Female | Unique |
| Sadachbia | Female | Unique |
| Sulafat | Female | Unique |

---

### Chirp Locales (51 languages)

af-ZA, ar-XA, bg-BG, bn-IN, ca-ES, cs-CZ, cy-GB, da-DK, de-DE, el-GR, en-AU, en-GB, en-IN, en-US, es-ES, es-US, eu-ES, fi-FI, fil-PH, fr-CA, fr-FR, gl-ES, gu-IN, he-IL, hi-IN, hu-HU, id-ID, is-IS, it-IT, ja-JP, kn-IN, ko-KR, lt-LT, lv-LV, ml-IN, mr-IN, ms-MY, nb-NO, nl-BE, nl-NL, pl-PL, pt-BR, pt-PT, ro-RO, ru-RU, sk-SK, sr-RS, sv-SE, ta-IN, te-IN, th-TH, tr-TR, uk-UA, vi-VN, zh-CN, zh-TW

---

## Music Generation

### Lyria Realtime (Experimental)

| Property | Value |
|---|---|
| **Model ID** | `lyria-realtime-exp` |
| **DB ID** | 232 |
| **Backend** | Gemini API v1alpha (WebSocket / Live Music API) |
| **Endpoint** | `/messages/music/` |
| **Transport** | SSE to frontend, WebSocket to Lyria API internally |
| **Worker** | No |

**Generation Parameters:**
- BPM: 60-200 (default 120)
- Duration: 10-120 seconds (default 30)
- Density: 0.0-1.0 (default 0.5, sparse to dense)
- Brightness: 0.0-1.0 (default 0.5, dark to bright)
- Guidance: 1.0-6.0 (default 3.5, free/creative to strict/prompt-aligned)
- Generation mode: QUALITY (consistent) or DIVERSITY (varied)
- Scales: 13 options (Unspecified, C Major/A Minor, D-flat Major, D Major, E-flat Major, E Major, F Major, G-flat Major, G Major, A-flat Major, A Major, B-flat Major, B Major)
- Weighted prompts: 1-4 prompts with individual weights (0.0-1.0)
- Instrument mutes: Bass, Drums (boolean toggles)
- Only Bass+Drums mode: Plays rhythm section only
- Parallel generation: No (1 only)

**Output:**
- Internal: PCM16 stereo 44.1kHz (176,400 bytes/second)
- Final: MP3 192kbps (via ffmpeg conversion)

**Flow:**
1. Connect to Lyria WebSocket
2. Send config (BPM, density, brightness, guidance, scale)
3. Send prompts with weights
4. Start playback, accumulate PCM chunks via callback
5. Close session when target duration reached (timeout: duration + 60s)
6. Convert PCM to MP3 via ffmpeg
7. Upload to S3
8. Save to DB with full settings JSON in `music_config` column

**Preview/Save/Discard:** Types defined but not fully implemented. Currently always saves directly.

---

## Architecture Summary

### Execution Patterns

| Pattern | Models |
|---|---|
| **SSE Direct** (generation in API route) | Nano Banana *, Gemini 3.1 Pro, VEO *, Grok Video, Kling Video *, All TTS, Lyria |
| **Worker Queue** (BullMQ + pub/sub SSE) | Imagen 4, Grok Image, Kling Image |
| **Long-Running Poll** (SDK polls operation) | VEO * |
| **REST Poll** (create task → poll status) | Grok Video, Kling Video *, Kling Image |
| **WebSocket** (internal to Lyria API) | Lyria |

### Parallel Generation

| Mechanism | Models | Max |
|---|---|---|
| N parallel requests (`skip_user_message`) | Nano Banana *, Gemini 3.1 Pro, VEO *, Gemini TTS, Chirp | 1-4 |
| Native multi-image (`numberOfImages` / `n`) | Imagen 4 | 1-4 |
| Native multi-image (`n`) | Grok Image | 1-10 |
| Native multi-image (`n`) | Kling Image | 1-9 |
| None | Grok Video, Kling Video *, Lyria | 1 |

### Rate Limiting

| System | Models | Details |
|---|---|---|
| **Redis Semaphore** | VEO 3.1 (HQ + Fast) | 9 slots/pool, 2 pools (primary + overflow), 18 max concurrent |
| **Exponential Backoff** | All models | 5s → 60s, 3 retries, 2x multiplier, on 429/500/503 |

### SSE Events by Type

| Event | Image (stream) | Image (imagen) | Video | Audio | Music |
|---|---|---|---|---|---|
| `user_message` | Yes | Yes | Yes | Yes | Yes |
| `progress` | No | Yes | Yes (status, message, %) | Yes (status, message) | Yes (message, %) |
| `chunk` (text) | Yes | No | No | No | No |
| `image` | Yes (url, index) | Yes | No | No | No |
| `video` | No | No | Yes (url, duration, audio, seed) | No | No |
| `audio` | No | No | No | Yes (url, duration, mimeType, voiceConfig) | No |
| `saved` | No | No | No | No | Yes (url, duration, cost) |
| `complete` | Yes (id, tokens, cost) | Yes | Yes (id, url) | Yes (messageId) | No |
| `title` | No | No | Yes | Yes | No |
| `grounding` | Yes (sources) | No | No | No | No |
| `error` | Yes | Yes | Yes | Yes | Yes |

### Storage

All files uploaded to S3 (`AWS_S3_BUCKET`) via CloudFront CDN (`AWS_CLOUDFRONT_DOMAIN`):
- Images: `{conversationId}/image-{timestamp}.{ext}`
- Videos: `{conversationId}/video-{timestamp}.mp4`
- Audio: `{conversationId}/audio-{timestamp}.{ext}`
- Music: `{conversationId}/music-{timestamp}.mp3`

### Environment Variables

```bash
# Google Gemini API
GEMINI_API_KEY=                      # Primary key
GEMINI_API_KEY_OVERFLOW=             # Overflow key (doubles VEO capacity to 18 slots)

# Google Vertex AI
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_GENAI_USE_VERTEXAI=           # Default backend

# xAI
XAI_API_KEY=

# Kling
KLING_ACCESS_KEY=
KLING_SECRET_KEY=

# Video Polling
VIDEO_POLLING_INITIAL_DELAY_MS=5000
VIDEO_POLLING_MAX_DELAY_MS=30000
VIDEO_POLLING_BACKOFF_MULTIPLIER=1.5
VIDEO_GENERATION_TIMEOUT_MS=900000

# Storage
AWS_S3_BUCKET=
AWS_CLOUDFRONT_DOMAIN=
GCS_BUCKET=

# Queue
REDIS_URL=
```
