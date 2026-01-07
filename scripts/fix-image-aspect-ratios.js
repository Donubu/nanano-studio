#!/usr/bin/env node

/**
 * Script para corregir los aspect ratios de las imágenes existentes
 * Descarga cada imagen, calcula sus dimensiones reales y actualiza la BD
 */

const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');
const { Buffer } = require('buffer');

// Configuración de BD desde variables de entorno
const dbConfig = {
  host: process.env.DB_HOST || 'host.docker.internal',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '121314',
  database: process.env.DB_NAME || 'nanano',
};

// Función para obtener dimensiones de una imagen desde URL
async function getImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);

        // Detectar PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          // PNG: dimensiones en bytes 16-23
          const width = buffer.readUInt32BE(16);
          const height = buffer.readUInt32BE(20);
          resolve({ width, height });
          return;
        }

        // Detectar JPEG
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
          // JPEG: buscar marcador SOF0 (0xFFC0) o SOF2 (0xFFC2)
          let i = 2;
          while (i < buffer.length - 9) {
            if (buffer[i] === 0xFF) {
              const marker = buffer[i + 1];
              if (marker === 0xC0 || marker === 0xC2) {
                const height = buffer.readUInt16BE(i + 5);
                const width = buffer.readUInt16BE(i + 7);
                resolve({ width, height });
                return;
              }
              // Saltar al siguiente marcador
              const length = buffer.readUInt16BE(i + 2);
              i += 2 + length;
            } else {
              i++;
            }
          }
        }

        // Detectar WebP
        if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
          // WebP VP8
          if (buffer.toString('ascii', 12, 16) === 'VP8 ') {
            const width = buffer.readUInt16LE(26) & 0x3FFF;
            const height = buffer.readUInt16LE(28) & 0x3FFF;
            resolve({ width, height });
            return;
          }
          // WebP VP8L (lossless)
          if (buffer.toString('ascii', 12, 16) === 'VP8L') {
            const bits = buffer.readUInt32LE(21);
            const width = (bits & 0x3FFF) + 1;
            const height = ((bits >> 14) & 0x3FFF) + 1;
            resolve({ width, height });
            return;
          }
        }

        reject(new Error('Formato de imagen no soportado'));
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Calcular aspect ratio desde dimensiones
function calculateAspectRatio(width, height) {
  const ratio = width / height;

  // Mapear a aspect ratios conocidos con tolerancia
  if (Math.abs(ratio - 1) < 0.05) return "1:1";
  if (Math.abs(ratio - 16/9) < 0.05) return "16:9";
  if (Math.abs(ratio - 9/16) < 0.05) return "9:16";
  if (Math.abs(ratio - 4/3) < 0.05) return "4:3";
  if (Math.abs(ratio - 3/4) < 0.05) return "3:4";
  if (Math.abs(ratio - 3/2) < 0.05) return "3:2";
  if (Math.abs(ratio - 2/3) < 0.05) return "2:3";
  if (Math.abs(ratio - 21/9) < 0.08) return "21:9";

  // Si no coincide exactamente, buscar el más cercano
  const knownRatios = [
    { name: "1:1", value: 1 },
    { name: "16:9", value: 16/9 },
    { name: "9:16", value: 9/16 },
    { name: "4:3", value: 4/3 },
    { name: "3:4", value: 3/4 },
    { name: "3:2", value: 3/2 },
    { name: "2:3", value: 2/3 },
    { name: "21:9", value: 21/9 },
  ];

  let closest = knownRatios[0];
  let minDiff = Math.abs(ratio - closest.value);

  for (const kr of knownRatios) {
    const diff = Math.abs(ratio - kr.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = kr;
    }
  }

  return closest.name;
}

async function main() {
  console.log('Conectando a la base de datos...');
  const connection = await mysql.createConnection(dbConfig);

  try {
    // Obtener todas las imágenes generadas
    const [images] = await connection.execute(`
      SELECT id, image_url, image_aspect_ratio
      FROM messages
      WHERE image_url IS NOT NULL
        AND image_url != ''
        AND role = 'model'
      ORDER BY id ASC
    `);

    console.log(`Encontradas ${images.length} imágenes para procesar\n`);

    let updated = 0;
    let errors = 0;
    let skipped = 0;

    for (const img of images) {
      process.stdout.write(`[${img.id}] ${img.image_url.substring(0, 60)}... `);

      try {
        const dims = await getImageDimensions(img.image_url);
        const newRatio = calculateAspectRatio(dims.width, dims.height);

        if (img.image_aspect_ratio === newRatio) {
          console.log(`OK (${dims.width}x${dims.height} = ${newRatio})`);
          skipped++;
        } else {
          await connection.execute(
            'UPDATE messages SET image_aspect_ratio = ? WHERE id = ?',
            [newRatio, img.id]
          );
          console.log(`ACTUALIZADO: ${img.image_aspect_ratio || 'NULL'} -> ${newRatio} (${dims.width}x${dims.height})`);
          updated++;
        }
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
        errors++;
      }

      // Pequeña pausa para no saturar el servidor
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n========== RESUMEN ==========`);
    console.log(`Total procesadas: ${images.length}`);
    console.log(`Actualizadas: ${updated}`);
    console.log(`Sin cambios: ${skipped}`);
    console.log(`Errores: ${errors}`);

  } finally {
    await connection.end();
  }
}

main().catch(console.error);
