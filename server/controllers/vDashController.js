// server/controllers/vDashController.js - CRUD operations supporting the volunteer dashboard
import { db } from '../db.js';

export const enrollInEvent = async (req, res) => {
  const { userId, eventId } = req.params;
  try {
    await db.query(
      `INSERT INTO volunteer_history (volunteer_id, event_id, event_status)
       SELECT ?, ?, 'Upcoming'
        WHERE NOT EXISTS (
          SELECT 1 FROM volunteer_history
           WHERE volunteer_id = ? AND event_id = ?
             AND event_status IN ('Upcoming','Attended')
        )`,
      [userId, eventId, userId, eventId]
    );
    res.status(201).json({ message: "Enrolled" });
  } catch (err) {
    console.error("browse-enroll error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getEnrolledEvents = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT e.event_id,
              e.event_name,
              e.event_description,
              e.event_location,
              e.urgency,
              e.start_time,
              e.end_time,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM volunteer_history h
         JOIN eventManage e    ON e.event_id = h.event_id
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s        ON s.skill_id = es.skill_id
        WHERE h.volunteer_id = ? AND h.event_status = 'Upcoming'
        GROUP BY e.event_id
        ORDER BY e.start_time`,
      [userId]
    );
    res.json({ events: rows });
  } catch (err) {
    console.error("enrolled-events error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getBrowseEvents = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT e.event_id,
              e.event_name,
              e.event_description,
              e.event_location,
              e.urgency,
              e.start_time,
              e.end_time,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM eventManage e
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s        ON s.skill_id = es.skill_id
        WHERE e.start_time >= NOW()
          AND e.event_id NOT IN (
            SELECT event_id FROM volunteer_history
             WHERE volunteer_id = ? AND event_status IN ('Upcoming','Attended')
          )
        GROUP BY e.event_id
        ORDER BY e.start_time`,
      [userId]
    );
    res.json({ events: rows });
  } catch (err) {
    console.error("browse-events error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getCalendarData = async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT e.event_id,
              e.event_name,
              e.event_location,
              e.start_time,
              e.end_time,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM volunteer_history h
         JOIN eventManage e    ON e.event_id = h.event_id
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s        ON s.skill_id = es.skill_id
        WHERE h.volunteer_id = ? AND h.event_status = 'Upcoming'
        GROUP BY e.event_id
        ORDER BY e.start_time`,
      [userId]
    );
    res.json({
      calendarData: rows.map(r => ({
        event_id: r.event_id,
        title:    r.event_name,
        start:    r.start_time,
        end:      r.end_time,
        event_location: r.event_location,
        required_skills: r.required_skills
      }))
    });
  } catch (err) {
    console.error("calendar error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};