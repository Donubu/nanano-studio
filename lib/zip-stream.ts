// ZIP en streaming, sin comprimir (los videos ya vienen comprimidos): escribe
// cada archivo a medida que llega, sin tenerlo entero en memoria. Usa
// descriptores de datos (el CRC y el tamaño van después de cada archivo) y
// ZIP64 cuando el ZIP pasa de 4 GB.

export interface ZipEntry {
  name: string;
  // Contenido en trozos (por ejemplo, el body de un fetch).
  data: AsyncIterable<Uint8Array>;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcUpdate(crc: number, buf: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MAX32 = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Bytes {
  private parts: number[] = [];
  u16(v: number) {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number) {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  u64(v: number) {
    this.u32(v % 0x100000000);
    return this.u32(Math.floor(v / 0x100000000));
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
    return this;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

/** Trozos del ZIP con `entries` en orden. */
export async function* zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, now = new Date()): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  for await (const entry of entries) {
    const name = enc.encode(entry.name);
    const localOffset = offset;
    // Encabezado local: CRC y tamaños en 0 (van en el descriptor). Bit 3 =
    // descriptor, bit 11 = nombre en UTF-8.
    const local = new Bytes()
      .u32(0x04034b50).u16(45).u16(0x0808).u16(0).u16(time).u16(date)
      .u32(0).u32(0).u32(0).u16(name.length).u16(0).raw(name).done();
    yield local;
    offset += local.length;

    let crc = 0;
    let size = 0;
    for await (const chunk of entry.data) {
      crc = crcUpdate(crc, chunk);
      size += chunk.length;
      yield chunk;
    }
    offset += size;

    const big = size >= MAX32;
    const desc = big
      ? new Bytes().u32(0x08074b50).u32(crc).u64(size).u64(size).done()
      : new Bytes().u32(0x08074b50).u32(crc).u32(size).u32(size).done();
    yield desc;
    offset += desc.length;

    // Campo extra ZIP64 si el tamaño o la posición no caben en 32 bits.
    const extra = new Bytes();
    if (big || localOffset >= MAX32) {
      const body = new Bytes();
      if (big) body.u64(size).u64(size);
      if (localOffset >= MAX32) body.u64(localOffset);
      const b = body.done();
      extra.u16(0x0001).u16(b.length).raw(b);
    }
    const extraBytes = extra.done();
    central.push(
      new Bytes()
        .u32(0x02014b50).u16(45).u16(45).u16(0x0808).u16(0).u16(time).u16(date)
        .u32(crc).u32(big ? MAX32 : size).u32(big ? MAX32 : size)
        .u16(name.length).u16(extraBytes.length).u16(0).u16(0).u16(0).u32(0)
        .u32(localOffset >= MAX32 ? MAX32 : localOffset)
        .raw(name).raw(extraBytes).done(),
    );
    count++;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) {
    yield c;
    cdSize += c.length;
  }
  const zip64 = cdOffset >= MAX32 || cdSize >= MAX32 || count >= 0xffff;
  if (zip64) {
    const eocd64Offset = cdOffset + cdSize;
    yield new Bytes()
      .u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0)
      .u64(count).u64(count).u64(cdSize).u64(cdOffset).done();
    yield new Bytes().u32(0x07064b50).u32(0).u64(eocd64Offset).u32(1).done();
  }
  yield new Bytes()
    .u32(0x06054b50).u16(0).u16(0)
    .u16(zip64 ? 0xffff : count).u16(zip64 ? 0xffff : count)
    .u32(zip64 ? MAX32 : cdSize).u32(zip64 ? MAX32 : cdOffset).u16(0).done();
}
