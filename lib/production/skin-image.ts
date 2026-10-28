// Recorte del fondo de las pieles gráficas. Nano Banana no entrega imágenes
// con transparencia, así que la piel se genera sobre un color clave plano
// (magenta o verde, el que no choque con la marca) y acá se quita:
//   1. color clave = mediana del borde de la imagen (el modelo nunca da el
//      hex exacto),
//   2. flood fill desde el borde sobre los píxeles parecidos a la clave, con
//      alfa suave en el contorno; además, los píxeles casi idénticos a la
//      clave en cualquier lado (huecos de una cinta, interior de un aro).
//      La clave oscurecida (la sombra que el modelo dibuja sobre el fondo)
//      pasa a sombra negra semitransparente en vez de quedar como un borde
//      morado o verde,
//   3. des-contaminación del contorno (se resta la clave mezclada),
//   4. recorte a lo visible y color promedio del centro (para contraste).
// keyOutRgba es puro (tests); processSkinImage usa sharp. Server-only.

import sharp from "sharp";

export interface KeyColor {
  name: string;
  hex: string;
}

const MAGENTA: KeyColor = { name: "magenta", hex: "#FF00FF" };
const GREEN: KeyColor = { name: "green", hex: "#00FF00" };

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hueSat(rgb: [number, number, number]): { hue: number; sat: number } {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, sat: max === 0 ? 0 : d / max };
}

// Magenta salvo que la piel vaya a tener rosados/morados saturados.
export function pickKeyColor(colors: string[]): KeyColor {
  const clash = colors.some((c) => {
    const rgb = hexToRgb(c);
    if (!rgb) return false;
    const { hue, sat } = hueSat(rgb);
    return sat > 0.35 && Math.min(Math.abs(hue - 300), 360 - Math.abs(hue - 300)) < 55;
  });
  return clash ? GREEN : MAGENTA;
}

// Distancias RGB: hasta SOFT_LO es fondo, desde SOFT_HI es la piel; en medio
// el contorno queda semitransparente. STRICT quita islas del color clave.
const SOFT_LO = 70;
const SOFT_HI = 150;
const STRICT = 40;
// Sombra: píxel sobre la recta negro→clave (residuo chico) y no casi negro
// (un contorno negro de la piel no debe abrir camino al flood fill).
const SHADOW_RESID = 45;
const SHADOW_MIN_T = 0.12;

export interface KeyedImage {
  data: Uint8Array; // RGBA recortado
  width: number;
  height: number;
  averageColor: string | null;
  opaqueRatio: number; // fracción de píxeles visibles antes del recorte
}

export function keyOutRgba(src: Uint8Array, width: number, height: number): KeyedImage {
  const px = width * height;
  const data = new Uint8Array(src);

  // 1. Clave = mediana por canal del anillo exterior (2% del lado).
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
      const i = (y * width + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  const median = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const key = [median(rs), median(gs), median(bs)];
  const dist = (i: number) =>
    Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]);
  // Proyección sobre la recta negro→clave: t = cuánto de la clave queda
  // (1 = fondo, 0 = negro) y el residuo = cuánto se aparta de esa recta.
  const keyNorm = key[0] * key[0] + key[1] * key[1] + key[2] * key[2] || 1;
  const shade = (i: number) => {
    const t = (data[i] * key[0] + data[i + 1] * key[1] + data[i + 2] * key[2]) / keyNorm;
    const resid = Math.hypot(data[i] - t * key[0], data[i + 1] - t * key[1], data[i + 2] - t * key[2]);
    return { t, resid };
  };
  const shadow = new Uint8Array(px);

  // 2. Flood fill desde el borde. Dos clases de píxel de fondo:
  //   - sobre la recta negro→clave (fondo limpio o sombreado): negro con
  //     alfa = cuánto oscurece la clave (fondo limpio → alfa 0),
  //   - cerca de la clave pero fuera de la recta: contorno de la piel
  //     mezclado con el fondo, alfa suave por distancia; ahí se detiene.
  const alpha = new Uint8Array(px).fill(255);
  const seen = new Uint8Array(px);
  const stack: number[] = [];
  const onKeyLine = (i: number) => {
    const { t, resid } = shade(i);
    return t > SHADOW_MIN_T && t < 1.15 && resid < SHADOW_RESID ? t : null;
  };
  const push = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (onKeyLine(i) != null || dist(i) < SOFT_HI) stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const i = p * 4;
    const t = onKeyLine(i);
    if (t != null) {
      const a = Math.round(Math.max(0, Math.min(1, 1 - t)) * 255);
      alpha[p] = a < 8 ? 0 : a;
      if (alpha[p] > 0) shadow[p] = 1;
    } else {
      const d = dist(i);
      alpha[p] = d <= SOFT_LO ? 0 : Math.round(((d - SOFT_LO) / (SOFT_HI - SOFT_LO)) * 255);
      // El contorno no avanza hacia adentro de la piel.
      if (d > SOFT_LO) continue;
    }
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }
  for (let p = 0; p < px; p++) {
    if (alpha[p] > 0 && dist(p * 4) < STRICT) alpha[p] = 0;
  }

  // 3. Des-contaminación: c = (observado − (1−a)·clave) / a.
  for (let p = 0; p < px; p++) {
    const i = p * 4;
    const a = alpha[p] / 255;
    data[i + 3] = alpha[p];
    if (shadow[p]) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    } else if (a > 0 && a < 1) {
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - a) * key[c]) / a)));
      }
    }
  }

  // 4. Recorte a lo visible (alfa > 16) con 2 px de aire.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let p = 0; p < px; p++) {
    if (alpha[p] <= 16) continue;
    opaque++;
    const x = p % width;
    const y = (p - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { data: new Uint8Array(0), width: 0, height: 0, averageColor: null, opaqueRatio: 0 };
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(width - 1, maxX + 2);
  maxY = Math.min(height - 1, maxY + 2);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const from = ((minY + y) * width + minX) * 4;
    out.set(data.subarray(from, from + cw * 4), y * cw * 4);
  }

  // Color promedio de la mitad central (donde va el texto), solo opacos.
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = Math.floor(ch * 0.25); y < Math.ceil(ch * 0.75); y++) {
    for (let x = Math.floor(cw * 0.25); x < Math.ceil(cw * 0.75); x++) {
      const i = (y * cw + x) * 4;
      if (out[i + 3] < 250) continue;
      sr += out[i];
      sg += out[i + 1];
      sb += out[i + 2];
      n++;
    }
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const averageColor = n > 0 ? `#${hex(sr / n)}${hex(sg / n)}${hex(sb / n)}`.toUpperCase() : null;

  return { data: out, width: cw, height: ch, averageColor, opaqueRatio: opaque / px };
}

const MAX_SIDE = 900;

export async function processSkinImage(
  input: Buffer,
): Promise<{ png: Buffer; width: number; height: number; averageColor: string | null }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const keyed = keyOutRgba(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
  if (keyed.width === 0 || keyed.opaqueRatio < 0.03) {
    throw new Error("No se pudo separar la piel del fondo; prueba otra descripción");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(keyed.width, keyed.height));
  const width = Math.max(1, Math.round(keyed.width * scale));
  const height = Math.max(1, Math.round(keyed.height * scale));
  const png = await sharp(Buffer.from(keyed.data), {
    raw: { width: keyed.width, height: keyed.height, channels: 4 },
  })
    .resize(width, height)
    // Paleta: las pieles son gráficas planas; pesa ~4× menos, importa en
    // HTML5 (los ad servers limitan el peso del banner).
    .png({ palette: true, quality: 90, effort: 8 })
    .toBuffer();
  return { png, width, height, averageColor: keyed.averageColor };
}
