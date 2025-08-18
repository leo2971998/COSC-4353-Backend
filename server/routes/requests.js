import express from "express";
import { db } from "../../config/db.js";

const router = express.Router();

router.post("/events/:eventId/requests", async (req, res) => {
  const { volunteerId, requestedBy } = req.body;
  const { eventId } = req.params;
  if (!volunteerId || !requestedBy)
    return res.status(400).json({ message: "volunteerId & requestedBy required" });
  try {
    const [r] = await db.query(
      `INSERT INTO event_volunteer_request
         (event_id, volunteer_id, requested_by)
       VALUES (?, ?, ?)`,
      [eventId, volunteerId, requestedBy]
    );
    await db.query(
      `INSERT INTO volunteer_request_notification
         (request_id, volunteer_id, message)
       VALUES (?, ?, ?)`,
      [r.insertId, volunteerId,
       `You’ve been requested for event #${eventId}. Please accept or decline.`]
    );
    res.status(201).json({ requestId: r.insertId });
  } catch (err) {
    console.error("POST /events/:eventId/requests →", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/requests/event/:eventId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.request_id, r.volunteer_id, l.full_name,
              r.status, r.requested_at, r.responded_at
         FROM event_volunteer_request r
         JOIN login l ON l.id = r.volunteer_id
        WHERE r.event_id = ?
        ORDER BY r.requested_at DESC`,
      [req.params.eventId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /requests/event/:eventId →", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/requests/volunteer/:volunteerId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.request_id, r.event_id, e.event_name,
              r.status, r.requested_at, r.responded_at
         FROM event_volunteer_request r
         JOIN eventManage e ON e.event_id = r.event_id
        WHERE r.volunteer_id = ?
        ORDER BY r.requested_at DESC`,
      [req.params.volunteerId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /requests/volunteer/:volunteerId →", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/events/:eventId/candidates", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT l.id  AS volunteer_id,
              l.full_name,
              COUNT(DISTINCT es.skill_id)             AS overlap,
              GROUP_CONCAT(DISTINCT s.skill_name)     AS skills
         FROM login            l
         JOIN profile_skill    ps ON ps.user_id = l.id
         JOIN skill            s  ON s.skill_id = ps.skill_id
         JOIN event_skill      es ON es.skill_id = s.skill_id
        WHERE es.event_id = ?  AND l.role = 'user'
        GROUP BY l.id
        ORDER BY overlap DESC, l.full_name`,
      [req.params.eventId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /events/:eventId/candidates →", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/vr-notifications/:volunteerId", async (req, res) => {
  const { volunteerId } = req.params;
  const showAll = String(req.query.all || "") === "1";
  try {
    const where = [`vrn.volunteer_id = ?`];
    const args  = [volunteerId];
    if (!showAll) {
      where.push(`vrn.is_read = 0`);
      where.push(`(evr.status IS NULL OR evr.status = 'Pending')`);
    }
    const [rows] = await db.query(
      `SELECT vrn.id,
              vrn.request_id,
              evr.event_id,
              evr.status,
              vrn.message,
              vrn.is_read,
              vrn.created_at
         FROM volunteer_request_notification AS vrn
         JOIN event_volunteer_request        AS evr
           ON evr.request_id = vrn.request_id
        WHERE ${where.join(" AND ")}
        ORDER BY vrn.created_at DESC`,
      args
    );
    const out = rows.map((r) => ({
      id:         r.id,
      request_id: r.request_id,
      event_id:   r.event_id,
      status:     r.status,
      message:    r.message,
      is_read:    !!r.is_read,
      created_at: r.created_at,
      type:       "request",
    }));
    res.json(out);
  } catch (err) {
    console.error("GET /vr-notifications error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/events/:eventId/requests/bulk", async (req, res) => {
  const { volunteerIds = [], requestedBy } = req.body;
  const { eventId } = req.params;
  if (!volunteerIds.length || !requestedBy)
    return res.status(400).json({ message: "volunteerIds[] & requestedBy required" });
  const uniq = [...new Set(volunteerIds.map(Number))];
  try {
    const values = uniq.map((id) => `(${db.escape(eventId)},${db.escape(id)},${db.escape(requestedBy)})`).join(",");
    await db.query(
      `INSERT IGNORE INTO event_volunteer_request (event_id, volunteer_id, requested_by)
       VALUES ${values}`
    );
    const [rows] = await db.query(
      `SELECT request_id, volunteer_id
         FROM event_volunteer_request
        WHERE event_id = ?
          AND volunteer_id IN (${uniq.map(() => "?").join(",")})`,
      [eventId, ...uniq]
    );
    if (!rows.length) return res.status(201).json({ sent: 0 });
    const notifVals = rows.map(
      (r) => `(${db.escape(r.request_id)}, ${db.escape(r.volunteer_id)},
               ${db.escape(`You’ve been requested for event #${eventId}. Please accept or decline.`)})`
    ).join(",");
    await db.query(
      `INSERT INTO volunteer_request_notification (request_id, volunteer_id, message)
       VALUES ${notifVals}`
    );
    res.status(201).json({ sent: rows.length });
  } catch (err) {
    console.error("POST /events/:eventId/requests/bulk →", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/requests/:id", async (req, res) => {
  const { status } = req.body; // "Accepted" | "Declined"
  if (!["Accepted", "Declined"].includes(status))
    return res.status(400).json({ message: "Invalid status" });
  const requestId = req.params.id;
  try {
    const [reqRows] = await db.query(
      `SELECT request_id, event_id, volunteer_id
         FROM event_volunteer_request
        WHERE request_id = ?`,
      [requestId]
    );
    if (!reqRows.length) return res.status(404).json({ message: "Request not found" });
    const { event_id, volunteer_id } = reqRows[0];
    await db.query(
      `UPDATE event_volunteer_request
          SET status = ?, responded_at = NOW()
        WHERE request_id = ?`,
      [status, requestId]
    );
    await db.query(
      `UPDATE volunteer_request_notification
          SET is_read = 1, responded_at = NOW()
        WHERE request_id = ?`,
      [requestId]
    );
    if (status === "Accepted") {
      await db.query(
        `INSERT INTO volunteer_history (volunteer_id, event_id, event_status)
         SELECT ?, ?, 'Upcoming'
          WHERE NOT EXISTS (
            SELECT 1 FROM volunteer_history
             WHERE volunteer_id = ? AND event_id = ?
               AND event_status IN ('Upcoming','Attended')
          )`,
        [volunteer_id, event_id, volunteer_id, event_id]
      );
    }
    res.json({ message: "Status updated", event_id, volunteer_id });
  } catch (err) {
    console.error("PATCH /requests/:id →", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
