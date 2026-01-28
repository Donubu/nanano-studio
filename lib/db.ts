import mysql from "mysql2/promise";

const basePool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00", // Interpretar fechas como UTC
  dateStrings: true, // Devolver fechas como strings para mejor control
  // Producción: manejar conexiones perdidas
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 segundos
  // Timeouts para evitar conexiones colgadas
  connectTimeout: 10000, // 10 segundos para conectar
  // idleTimeout: 60000, // No disponible en mysql2, se maneja automáticamente
});

// Configurar timezone UTC en cada conexión nueva
basePool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

const pool = basePool;

export default pool;
