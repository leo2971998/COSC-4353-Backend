import express from "express";
import { query } from "../../config/db.js";

const router = express.Router();

router.get("/history/:userId", async (req, res) => {
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
});

export default router;
