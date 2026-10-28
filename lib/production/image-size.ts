// Dimensiones de una imagen leyendo solo su cabecera (PNG, JPEG, WebP), sin
// decodificarla. La usa el reencuadre de "Pídele a la IA" para calcular
// cómo queda la foto recortada en su caja.

export function imageSize(buf: Uint8Array): { w: number; h: number } | null {
  const u16be = (i: number) => (buf[i] << 8) | buf[i + 1];
  const u32be = (i: number) => ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
  const u16le = (i: number) => buf[i] | (buf[i + 1] << 8);
  const u24le = (i: number) => buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);

  // PNG: firma + IHDR (ancho y alto big-endian en 16 y 20).
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: u32be(16), h: u32be(20) };
  }
  // JPEG: recorrer segmentos hasta un SOF (C0-CF salvo C4, C8, CC).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: u16be(i + 7), h: u16be(i + 5) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X.
  if (buf.length >= 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) {
    const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (chunk === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.subarray(21, 25);
      return { w: 1 + (((b[1] & 0x3f) << 8) | b[0]), h: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { w: 1 + u24le(24), h: 1 + u24le(27) };
  }
  return null;
}
