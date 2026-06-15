import mysql from "mysql2/promise";

const basePool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  // OJO: este límite es control de admisión, NO un techo a subir libremente.
  // La instancia Cloud SQL es chica (~1 vCPU, buffer_pool 0.63GB). Subirlo a 150
  // dejó correr ~90 queries a la vez sobre 1 vCPU -> thrashing -> queries de 10ms
  // pasaron a 14s -> pool agotado -> "Queue limit reached" en todo. El pool chico
  // PROTEGE a la instancia. El cuello real es el VOLUMEN de queries (poll del
  // badge de créditos) y el tamaño de la instancia, no este número.
  connectionLimit: Number(process.env.DB_POOL_LIMIT) || 50,
  queueLimit: 250,
  timezone: "-03:00", // Chile (America/Santiago)
  dateStrings: true, // Devolver fechas como strings para mejor control
  // Producción: manejar conexiones perdidas
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 segundos
  // Timeouts para evitar conexiones colgadas
  connectTimeout: 10000, // 10 segundos para conectar
  // idleTimeout: 60000, // No disponible en mysql2, se maneja automáticamente
});

// Configurar timezone Chile en cada conexión nueva
basePool.on("connection", (connection) => {
  connection.query("SET time_zone = 'America/Santiago'");
});

const pool = basePool;

export default pool;
