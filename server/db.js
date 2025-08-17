// server/db.js - Database connection and utilities
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

/* ──────────────────────────────────────────────────────────────
   MySQL pool  + connectivity check
   ─────────────────────────────────────────────────────────── */
const db = mysql.createPool({
  host: process.env.DB_HOST || "192.168.1.198",
  port: 3306,
  user: process.env.DB_USER || "Leo",
  password: process.env.DB_PASSWORD || "Test=123!",
  database: process.env.DB_NAME || "COSC4353",
  connectionLimit: 5,
});

const USE_DB =
  String(process.env.USE_DB || "")
    .toLowerCase()
    .match(/^(1|true)$/) !== null;

const query = async (sql, params) => {
  const [results] = await db.execute(sql, params);
  return results;
};

const ensureSkills = async (names = []) => {
  const list = Array.isArray(names) ? names : String(names || "").split(",");
  const ids = [];
  for (const raw of list) {
    const name = raw.trim();
    if (!name) continue;
    const [rows] = await db.query("SELECT skill_id FROM skill WHERE skill_name = ?", [name]);
    let sid;
    if (rows.length) sid = rows[0].skill_id;
    else {
      const [ins] = await db.query("INSERT INTO skill (skill_name) VALUES (?)", [name]);
      sid = ins.insertId;
    }
    ids.push(sid);
  }
  return [...new Set(ids)];
};

const replaceEventSkills = async (eventId, skillNames = []) => {
  const ids = await ensureSkills(skillNames);
  await db.query("DELETE FROM event_skill WHERE event_id = ?", [eventId]);
  if (!ids.length) return;
  const values = ids.map((sid) => `(${db.escape(eventId)}, ${db.escape(sid)})`).join(",");
  await db.query(`INSERT INTO event_skill (event_id, skill_id) VALUES ${values}`);
};

// Test connection
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

export { db, USE_DB, query, ensureSkills, replaceEventSkills };