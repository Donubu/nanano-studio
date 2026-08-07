/**
 * Agrega Gemini Omni como modelo de video (y default) a todos los proyectos
 * que aún no lo tengan. Misma lógica que la migración 126, pero re-ejecutable:
 * la migración corre una sola vez, así que los proyectos creados después
 * quedan sin Omni hasta correr esto.
 *
 * No quita modelos existentes: agrega Omni al final de la lista de video del
 * proyecto y traspasa el flag is_default. Idempotente.
 *
 * Run with: node scripts/add-omni-video.js
 * (contra prod: source .env.production primero, o exportar DB_*)
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'host.docker.internal',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '121314',
  database: process.env.DB_NAME || 'nanano',
};

async function addOmniVideo() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    const [models] = await connection.execute(
      `SELECT id FROM models WHERE model_id = 'gemini-omni-flash-preview' AND api_backend = 'omni' LIMIT 1`
    );
    if (models.length === 0) {
      console.error('❌ Modelo gemini-omni-flash-preview (api_backend=omni) no existe en `models`. ¿Corrió la migración 124?');
      process.exit(1);
    }
    const omniModelId = models[0].id;

    const [missing] = await connection.execute(
      `SELECT p.id, p.title FROM projects p
       WHERE p.id NOT IN (
         SELECT pgm.project_id FROM project_generation_models pgm
         WHERE pgm.generation_type = 'video' AND pgm.model_id = ?
       )`,
      [omniModelId]
    );

    if (missing.length === 0) {
      console.log('✅ Todos los proyectos ya tienen Omni como modelo de video.');
    } else {
      console.log(`📦 ${missing.length} proyecto(s) sin Omni:`);
      for (const p of missing) console.log(`   - [${p.id}] ${p.title}`);

      await connection.execute(
        `INSERT IGNORE INTO project_generation_models
           (project_id, generation_type, model_id, label, sort_order, is_default)
         SELECT p.id, 'video', ?, 'Omni',
           COALESCE((
             SELECT MAX(pgm.sort_order) + 1
             FROM project_generation_models pgm
             WHERE pgm.project_id = p.id AND pgm.generation_type = 'video'
           ), 0),
           0
         FROM projects p
         WHERE p.id NOT IN (
           SELECT pgm2.project_id FROM project_generation_models pgm2
           WHERE pgm2.generation_type = 'video' AND pgm2.model_id = ?
         )`,
        [omniModelId, omniModelId]
      );
    }

    // Traspasar el default a Omni en todos los proyectos (por si algún
    // proyecto lo tiene pero con otro modelo como default).
    const [unset] = await connection.execute(
      `UPDATE project_generation_models
       SET is_default = 0
       WHERE generation_type = 'video' AND model_id != ? AND is_default = 1`,
      [omniModelId]
    );
    const [set] = await connection.execute(
      `UPDATE project_generation_models
       SET is_default = 1
       WHERE generation_type = 'video' AND model_id = ? AND is_default = 0`,
      [omniModelId]
    );
    if (unset.affectedRows || set.affectedRows) {
      console.log(`🔁 Default traspasado a Omni en ${set.affectedRows} proyecto(s).`);
    }

    const [check] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS total,
         (SELECT COUNT(*) FROM project_generation_models
          WHERE generation_type = 'video' AND model_id = ? AND is_default = 1) AS con_omni_default`,
      [omniModelId]
    );
    console.log(`\n✅ ${check[0].con_omni_default}/${check[0].total} proyectos con Omni como video default.`);
  } finally {
    await connection.end();
  }
}

addOmniVideo().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
