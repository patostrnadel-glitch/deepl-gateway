import mysql from "mysql2/promise";

export const db = await mysql.createPool({
  host: process.env.DB_HOST,      // nastavíš v Render env
  user: process.env.DB_USER,      // nastavíš v Render env
  password: process.env.DB_PASS,  // nastavíš v Render env
  database: process.env.DB_NAME,  // nastavíš v Render env
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
