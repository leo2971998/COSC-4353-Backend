import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const db = mysql.createPool({
  host: process.env.DB_HOST || "192.168.1.198",
  port: 3306,
  user: process.env.DB_USER || "Leo",
  password: process.env.DB_PASSWORD || "Test=123!",
  database: process.env.DB_NAME || "COSC4353",
  connectionLimit: 5,
});

export const USE_DB =
  String(process.env.USE_DB || "")
    .toLowerCase()
    .match(/^(1|true)$/) !== null;

export const query = async (sql, params) => {
  const [results] = await db.execute(sql, params);
  return results;
};

(async () => {
  try {
    const conn = await db.getConnection();
    await conn.ping();
    console.log("✅  MySQL connection pool ready (ping OK)"); // eslint-disable-line no-console
    conn.release();
  } catch (err) {
    console.error("❌  MySQL connection failed:", err.message); // eslint-disable-line no-console
  }
})();
