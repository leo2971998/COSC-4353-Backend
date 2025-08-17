// server/controllers/eventController.js - Event retrieval utilities
import { db, replaceEventSkills } from '../db.js';

// In-memory fallback for non-DB mode
let eventsMemory = [];

export const getAllEvents = async (req, res) => {
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

    /* refresh fallback cache so FE still works if DB dies later */
    eventsMemory = rows;
    res.json({ events: rows });
  } catch (err) {
    console.error("GET /events DB error:", err.message);   // eslint-disable-line no-console

    /* fall back to last-known cache so the calendar doesn't break */
    if (eventsMemory.length) return res.json({ events: eventsMemory });

    res.status(500).json({ message: "Error fetching events" });
  }
};

export const createEvent = async (req, res) => {
  try {
    const b = req.body;
    const [r] = await db.query(
      `INSERT INTO eventManage
       (event_name,event_description,event_location,urgency,start_time,end_time,created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [b.event_name,b.event_description,b.event_location,b.urgency,b.start_time,b.end_time,b.created_by]
    );

    // persist skills
    await replaceEventSkills(r.insertId, b.skills);

    res.status(201).json({ event_id: r.insertId });
  } catch (err) {
    console.error("POST /events error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateEvent = async (req, res) => {
  try {
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

    // replace skill links
    await replaceEventSkills(id, b.skills);

    res.json({ message:"Event updated" });
  } catch (err) {
    console.error("PUT /events/:id error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteEvent = async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM event_skill WHERE event_id = ?", [id]);
    await conn.query("DELETE FROM volunteer_history WHERE event_id = ?", [id]);
    await conn.query("DELETE FROM eventManage WHERE event_id = ?", [id]);
    await conn.commit();
    res.json({ message: "Event deleted successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("DELETE /events/:id error:", err.message);
    res.status(500).json({ message: "Server error" });
  } finally {
    conn.release();
  }
};

export const getEventById = async (req, res) => {
  try {
    const { eventId } = req.params;
    const [rows] = await db.query(
      `SELECT  e.event_id,
               e.event_name,
               e.event_description,
               e.event_location,
               e.urgency,
               e.start_time,
               e.end_time,
               GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM  eventManage e
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s ON s.skill_id = es.skill_id
        WHERE  e.event_id = ?
        GROUP BY e.event_id`,
      [eventId]
    );

    if (!rows.length) return res.status(404).json({ message: "Event not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET /events/by-id/:eventId error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

export const getEventsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await db.query(
      `SELECT  e.event_id,
               e.event_name,
               e.event_description,
               e.event_location,
               e.urgency,
               e.start_time,
               e.end_time,
               GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM  eventManage e
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s ON s.skill_id = es.skill_id
        WHERE  e.created_by = ?
        GROUP BY e.event_id
        ORDER BY e.start_time`,
      [userId]
    );

    res.json({ events: rows });
  } catch (err) {
    console.error("GET /events/:userId error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Request management functions
export const createEventRequest = async (req, res) => {
  const { volunteerId, requestedBy } = req.body;
  const { eventId } = req.params;

  if (!volunteerId || !requestedBy)
    return res.status(400).json({ message: "volunteerId & requestedBy required" });

  try {
    /* insert request */
    const [r] = await db.query(
      `INSERT INTO event_volunteer_request
         (event_id, volunteer_id, requested_by)
       VALUES (?, ?, ?)`,
      [eventId, volunteerId, requestedBy]
    );

    /* optional: notify volunteer immediately */
    await db.query(
      `INSERT INTO volunteer_request_notification
         (request_id, volunteer_id, message)
       VALUES (?, ?, ?)`,
      [r.insertId, volunteerId,
       `You've been requested for event #${eventId}. Please accept or decline.`]
    );

    res.status(201).json({ requestId: r.insertId });
  } catch (err) {
    console.error("POST /events/:eventId/requests →", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getRequestsForEvent = async (req, res) => {
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
};

export const getRequestsForVolunteer = async (req, res) => {
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
};

export const createBulkEventRequests = async (req, res) => {
  const { volunteerIds = [], requestedBy } = req.body;
  const { eventId } = req.params;

  if (!volunteerIds.length || !requestedBy)
    return res.status(400).json({ message: "volunteerIds[] & requestedBy required" });

  const uniq = [...new Set(volunteerIds.map(Number))];

  try {
    // 1) optional: prevent dup pairs (add a unique index in DB: UNIQUE(event_id,volunteer_id))
    //    If you can't add the index yet, INSERT IGNORE is fine.
    const values = uniq.map((id) => `(${db.escape(eventId)},${db.escape(id)},${db.escape(requestedBy)})`).join(",");
    await db.query(
      `INSERT IGNORE INTO event_volunteer_request (event_id, volunteer_id, requested_by)
       VALUES ${values}`
    );

    // 2) fetch fresh request_ids for those pairs
    const [rows] = await db.query(
      `SELECT request_id, volunteer_id
         FROM event_volunteer_request
        WHERE event_id = ?
          AND volunteer_id IN (${uniq.map(() => "?").join(",")})`,
      [eventId, ...uniq]
    );

    if (!rows.length) return res.status(201).json({ sent: 0 });

    // 3) insert notifications using the fetched request_ids
    const notifVals = rows.map(
      (r) => `(${db.escape(r.request_id)}, ${db.escape(r.volunteer_id)},
               ${db.escape(`You've been requested for event #${eventId}. Please accept or decline.`)})`
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
};

export const updateRequestStatus = async (req, res) => {
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
};