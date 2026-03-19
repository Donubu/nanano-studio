import mysql from "mysql2/promise";

const basePool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50,
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
