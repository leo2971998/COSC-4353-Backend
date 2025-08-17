import express from "express";
import { db, query } from "../config/db.js";
import { replaceEventSkills } from "../utils/skills.js";
import { getEventsMemory, setEventsMemory } from "../memory.js";

const router = express.Router();

// GET  /events  – all events (joined with skills)
router.get("/events", async (_req, res) => {
  try {
    const sql = `
      SELECT  e.event_id,
              e.event_name,
              e.event_description,
              e.event_location,
              e.urgency,
              e.start_time,
              e.end_time,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
        FROM  eventManage        e
        LEFT JOIN event_skill    es ON es.event_id = e.event_id
        LEFT JOIN skill          s  ON s.skill_id  = es.skill_id
       GROUP BY e.event_id
       ORDER BY e.start_time`;
    const [rows] = await db.query(sql);
    setEventsMemory(rows);
    res.json({ events: rows });
  } catch (err) {
    console.error("GET /events DB error:", err.message);   // eslint-disable-line no-console
    const cached = getEventsMemory();
    if (cached.length) return res.json({ events: cached });
    res.status(500).json({ message: "Error fetching events" });
  }
});

// create
router.post("/events", async (req, res) => {
  const b = req.body;
  const [r] = await db.query(
    `INSERT INTO eventManage
     (event_name,event_description,event_location,urgency,start_time,end_time,created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [b.event_name,b.event_description,b.event_location,b.urgency,b.start_time,b.end_time,b.created_by]
  );
  await replaceEventSkills(r.insertId, b.skills);
  res.status(201).json({ event_id: r.insertId });
});

// update
router.put("/events/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  await db.query(
    `UPDATE eventManage
        SET event_name=?,
            event_description=?,
            event_location=?,
            urgency=?,
            start_time=?,
            end_time=?
      WHERE event_id=?`,
    [b.event_name,b.event_description,b.event_location,b.urgency,b.start_time,b.end_time,id]
  );
  await replaceEventSkills(id, b.skills);
  res.json({ message:"Event updated" });
});

// delete
router.delete("/events/:id", async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [reqRows] = await conn.query(
      "SELECT request_id FROM event_volunteer_request WHERE event_id = ?",
      [id]
    );
    if (reqRows.length) {
      const reqIds = reqRows.map(r => r.request_id);
      await conn.query(
        `DELETE FROM volunteer_request_notification
            WHERE request_id IN (${reqIds.map(() => "?").join(",")})`,
        reqIds
      );
    }
    await conn.query("DELETE FROM event_skill WHERE event_id=?", [id]);
    await conn.query("DELETE FROM volunteer_history WHERE event_id=?", [id]);
    await conn.query("DELETE FROM event_volunteer_request WHERE event_id=?", [id]);
    await conn.query("DELETE FROM eventManage WHERE event_id=?", [id]);
    await conn.commit();
    res.json({ message: "Event deleted" });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE /events/:id", err.message);
    res.status(500).json({ message: "Server error" });
  } finally {
    conn.release();
  }
});

router.get("/events/by-id/:eventId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
           FROM eventManage e
           LEFT JOIN event_skill es ON es.event_id = e.event_id
           LEFT JOIN skill s       ON s.skill_id  = es.skill_id
          WHERE e.event_id = ?
          GROUP BY e.event_id`,
      [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ message: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("/events/by-id:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// events created by / assigned to a user
router.get("/events/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await query(`SELECT * FROM eventManage WHERE created_by = ?`, [userId]);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching user events:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
