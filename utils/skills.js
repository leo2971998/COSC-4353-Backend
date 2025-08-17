import { db } from "../config/db.js";

export const ensureSkills = async (names = []) => {
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

export const replaceEventSkills = async (eventId, skillNames = []) => {
  const ids = await ensureSkills(skillNames);
  await db.query("DELETE FROM event_skill WHERE event_id = ?", [eventId]);
  if (!ids.length) return;
  const values = ids
    .map((sid) => `(${db.escape(eventId)}, ${db.escape(sid)})`)
    .join(",");
  await db.query(`INSERT INTO event_skill (event_id, skill_id) VALUES ${values}`);
};
