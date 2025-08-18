import express from "express";
import { db } from "../../config/db.js";

const router = express.Router();

router.get("/reports/event-summary", async (req, res) => {
  const { start, end, urgency, status } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });
  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];
  if (urgency && urgency !== "All") {
    where.push("e.urgency = ?");
    args.push(urgency);
  }
  const sql = `
      SELECT e.event_id,
             e.event_name,
             e.urgency,
             e.event_location,
             e.start_time,
             e.end_time,
             COUNT(r.request_id)                        AS total_requests,
             SUM(r.status='Pending')   AS pending,
             SUM(r.status='Accepted')  AS accepted,
             SUM(r.status='Declined')  AS declined
        FROM eventManage e
        LEFT JOIN event_volunteer_request r ON r.event_id = e.event_id
       WHERE ${where.join(" AND ")}
       GROUP BY e.event_id
       ${status && status !== "All" ? `HAVING ${status.toLowerCase()} > 0` : ""}
       ORDER BY e.start_time`;
  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("event-summary error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/reports/volunteer-activity", async (req, res) => {
  const { start, end, urgency = "All", status = "All" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });
  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];
  if (urgency && urgency !== "All") { where.push("e.urgency = ?"); args.push(urgency); }
  if (status  && status  !== "All") { where.push("h.event_status = ?"); args.push(status); }
  const sql = `
      SELECT
        h.volunteer_id,
        l.full_name,
        COUNT(DISTINCT h.event_id) AS events,
        SUM(
          CASE WHEN h.event_status='Attended' THEN
            COALESCE(
              h.hours_served,
              TIMESTAMPDIFF(
                MINUTE,
                LEAST(e.start_time, e.end_time),
                GREATEST(e.start_time, e.end_time)
              )/60.0
            )
          ELSE 0 END
        ) AS hours,
        SUM(h.event_status='Attended') AS attended,
        SUM(h.event_status='Missed')   AS missed,
        SUM(h.event_status='Withdrew') AS withdrew,
        AVG(NULLIF(h.rating,0))        AS avg_rating,
        MIN(e.start_time)              AS first_event,
        MAX(e.start_time)              AS last_event
      FROM volunteer_history h
      JOIN eventManage e ON e.event_id = h.event_id
      JOIN login       l ON l.id = h.volunteer_id
      WHERE ${where.join(" AND ")}
      GROUP BY h.volunteer_id, l.full_name
      ORDER BY l.full_name
    `;
  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("volunteer-activity error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/reports/volunteer-activity/by-event", async (req, res) => {
  const { start, end, urgency = "All", status = "All" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });
  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];
  if (urgency !== "All") { where.push("e.urgency = ?"); args.push(urgency); }
  if (status  !== "All") { where.push("h.event_status = ?"); args.push(status); }
  const sql = `
      SELECT
        e.event_id,
        e.event_name,
        e.event_location,
        e.start_time,
        e.end_time,
        COUNT(h.volunteer_id) AS volunteers,
        SUM(h.event_status='Attended') AS attended,
        SUM(h.event_status='Missed')   AS missed,
        SUM(h.event_status='Withdrew') AS withdrew,
        AVG(NULLIF(h.rating,0))        AS avg_rating
      FROM volunteer_history h
      JOIN eventManage e ON e.event_id = h.event_id
      WHERE ${where.join(" AND ")}
      GROUP BY e.event_id, e.event_name, e.event_location, e.start_time, e.end_time
      ORDER BY e.start_time
    `;
  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("volunteer-activity/by-event error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/reports/volunteer-activity/timeseries", async (req, res) => {
  const { start, end, bucket = "day", status = "All" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });
  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];
  if (status !== "All") { where.push("h.event_status = ?"); args.push(status); }
  const bucketExpr =
    bucket === "week"
      ? "DATE_FORMAT(e.start_time, '%x-%v')"
      : "DATE(e.start_time)";
  const sql = `
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS events,
        SUM(h.event_status='Attended') AS attended,
        SUM(h.event_status='Missed')   AS missed,
        SUM(h.event_status='Withdrew') AS withdrew,
        SUM(COALESCE(h.hours_served,
                     TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time)/60.0)) AS hours
      FROM volunteer_history h
      JOIN eventManage e ON e.event_id = h.event_id
      WHERE ${where.join(" AND ")}
      GROUP BY bucket
      ORDER BY MIN(e.start_time)
    `;
  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("timeseries error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/reports/top-volunteers", async (req, res) => {
  const { start, end, limit = 10 } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });
  const sql = `
      SELECT
        l.id AS volunteer_id,
        COALESCE(l.full_name,'(no name)') AS full_name,
        COUNT(*) AS events,
        SUM(COALESCE(h.hours_served,
                     TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time)/60.0)) AS hours
      FROM volunteer_history h
      JOIN eventManage e ON e.event_id = h.event_id
      JOIN login l ON l.id = h.volunteer_id
      WHERE e.start_time BETWEEN ? AND ?
        AND h.event_status = 'Attended'
      GROUP BY l.id, l.full_name
      ORDER BY hours DESC, events DESC
      LIMIT ?
    `;
  try {
    const [rows] = await db.query(sql, [start, `${end} 23:59:59`, Number(limit)]);
    res.json(rows);
  } catch (err) {
    console.error("top-volunteers error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
