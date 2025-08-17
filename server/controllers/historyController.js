// server/controllers/historyController.js - Logic for assembling volunteer history data
import { db, query } from '../db.js';

export const getVolunteerHistory = async (req, res) => {
  try {
    const volunteer_id = req.params.userId;
    const sql = `
      SELECT vh.history_id,
             em.event_id,
             em.event_name,
             em.event_description,
             em.event_location,
             em.start_time,
             vh.event_status,
             em.urgency,
             GROUP_CONCAT(sk.skill_name) AS skills
        FROM volunteer_history AS vh
        JOIN eventManage      AS em ON vh.event_id = em.event_id
        JOIN event_skill      AS ek ON em.event_id = ek.event_id
        JOIN skill            AS sk ON ek.skill_id = sk.skill_id
       WHERE vh.volunteer_id = ?
       GROUP BY vh.history_id, em.event_id`;
    const volunteer_history = await query(sql, [volunteer_id]);
    res.json({ volunteer_history });
  } catch (err) {
    console.error("History fetch error:", err.message); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
};

export const getVolunteerDashboard = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT e.event_id,
              e.event_name,
              e.event_description,
              e.event_location,
              e.start_time,
              e.end_time,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM volunteer_history h
         JOIN eventManage e    ON e.event_id = h.event_id
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s        ON s.skill_id = es.skill_id
        WHERE h.volunteer_id = ?
          AND h.event_status = 'Upcoming'
          AND e.start_time > NOW()
        GROUP BY e.event_id
        ORDER BY e.start_time
        LIMIT 1`,
      [userId]
    );
    res.json({ nextEvent: rows });
  } catch (err) {
    console.error("Dashboard fetch error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};