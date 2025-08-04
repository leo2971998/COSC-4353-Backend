// server.js  – run locally with:  node server.js
// package.json must have  { "type": "module" }  if you want to keep import/export syntax.

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const app = express();

/* ──────────────────────────────────────────────────────────────
   CORS  (adjust the origin list to suit your front-end hosts)
   ─────────────────────────────────────────────────────────── */
const corsOptions = { origin: ["http://localhost:5173"] };
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // pre-flight

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

/* ──────────────────────────────────────────────────────────────
   Express middleware
   ─────────────────────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log every incoming request (helpful on Vercel logs)
app.use((req, _res, next) => {
  console.log(`${req.method}  ${req.url}`); // eslint-disable-line no-console
  next();
});

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ──────────────────────────────────────────────────────────────
   In-memory fall-backs for non-DB mode
   ─────────────────────────────────────────────────────────── */
let eventsMemory   = [];                        // for /events in non-DB mode
let notificationsMemory = [];                  // simple in-RAM inbox
const mockVolunteers  = [];                    // supply your seed data if needed
const staticEvents    = [];                    // idem – used by suggested-events

const addNotification = async (userId, message) => {
  if (!USE_DB) {
    const n = { id: Date.now(), userId: Number(userId), message, read: false };
    notificationsMemory.push(n);
    return n;
  }
  await query(
    "INSERT INTO notifications (userId, message, is_read) VALUES (?, ?, ?)",
    [Number(userId), message, 0]
  );
  return { id: undefined, userId: Number(userId), message, read: false };
};

/* ──────────────────────────────────────────────────────────────
   EVENTS  (create / list / user-specific list)
   ─────────────────────────────────────────────────────────── */

/** GET  /events  – all events (joined with skills) */
app.get("/events", async (req, res) => {
  /* ─── DB mode: join eventManage → event_skill → skill ─── */
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

    /* fall back to last-known cache so the calendar doesn’t break */
    if (eventsMemory.length) return res.json({ events: eventsMemory });

    res.status(500).json({ message: "Error fetching events" });
  }
});

/** POST /events  – create a new event
 *  Accepts either camelCase or snake_case body fields.
 */
app.post("/events", async (req, res) => {
  const body = req.body;
  const event_name        = body.event_name        ?? body.eventName;
  const event_description = body.event_description ?? body.eventDescription;
  const event_location    = body.event_location    ?? body.location;
  const urgency           = body.urgency;
  const start_time        = body.start_time        ?? body.eventDate ?? body.start_time;
  const end_time          = body.end_time          ?? body.endDate   ?? body.end_time;
  const user_id           = body.user_id           ?? body.userId    ?? null;

  if (!event_name || !start_time || !end_time) {
    return res
      .status(400)
      .json({ message: "event_name, start_time, end_time are required" });
  }

  try {
    const sql = `
      INSERT INTO eventManage
        (event_name, event_description, event_location,
         urgency, start_time, end_time, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await query(sql, [
      event_name,
      event_description ?? null,
      event_location ?? null,
      urgency ?? null,
      start_time,
      end_time,
      user_id,
    ]);

    const newEvent = { event_id: result.insertId, ...body };
    if (!USE_DB) eventsMemory.push(newEvent);
    res.status(201).json({ message: "Event created", event: newEvent });
  } catch (err) {
    console.error("Error creating event:", err.message); // eslint-disable-line no-console
    res.status(500).json({ message: "Error creating event" });
  }
});

/** GET /events/:userId  – events created by / assigned to a user */
app.get("/events/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await query(
      `SELECT * FROM eventManage WHERE user_id = ?`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching user events:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   VOLUNTEER MATCHING  (/api/match)
   ─────────────────────────────────────────────────────────── */
app.get("/api/match/:volunteerId", async (req, res) => {
  const { volunteerId } = req.params;

  try {
    let volunteer;
    if (USE_DB) {
      const [rows] = await db.query(
        `SELECT id, location, skills, preferences,
                availability_start, availability_end
           FROM volunteers
          WHERE id = ?`,
        [volunteerId]
      );
      if (!rows.length) return res.status(404).json({ message: "Volunteer not found" });

      volunteer = rows[0];
      volunteer.skills       = (volunteer.skills       || "").split(",").map((s) => s.trim()).filter(Boolean);
      volunteer.preferences  = (volunteer.preferences  || "").split(",").map((s) => s.trim()).filter(Boolean);
      volunteer.availability = {
        start: volunteer.availability_start,
        end:   volunteer.availability_end,
      };
    } else {
      volunteer = mockVolunteers.find((v) => String(v.id) === String(volunteerId));
      if (!volunteer) return res.status(404).json({ message: "Volunteer not found" });
    }

    // When not using DB, `events` is the in-memory array you manage elsewhere.
    const matchedEvents = (USE_DB ? eventsMemory : staticEvents)
      .map((ev) => {
        const locationMatch   = ev.event_location === volunteer.location;
        const matchedSkills   = (ev.required_skills || "").split(",").filter((s) => volunteer.skills.includes(s));
        const skillScore      = matchedSkills.length;
        const availabilityMatch =
          new Date(volunteer.availability?.start) <= new Date(ev.start_time) &&
          new Date(volunteer.availability?.end)   >= new Date(ev.end_time);
        const preferenceBonus = volunteer.preferences.includes(ev.preferenceTag) ? 1 : 0;

        return {
          ...ev,
          matchScore:
            (locationMatch ? 1 : 0) +
            (availabilityMatch ? 1 : 0) +
            skillScore +
            preferenceBonus,
          matchedSkills,
        };
      })
      .filter((ev) => ev.matchScore > 2)
      .sort((a, b) => b.matchScore - a.matchScore);

    if (matchedEvents.length) {
      await addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].event_name}!`);
    }

    res.json(matchedEvents);
  } catch (err) {
    console.error("Match error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   NOTIFICATIONS
   ─────────────────────────────────────────────────────────── */
app.get("/notifications", async (_req, res) => {
  if (!USE_DB) return res.json({ notifications: notificationsMemory });

  try {
    const [rows] = await db.query(
      "SELECT id, userId, message, is_read FROM notifications ORDER BY id DESC"
    );
    const out = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      message: r.message,
      read: !!(r.is_read),
    }));
    res.json({ notifications: out });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/notifications/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!USE_DB) {
    return res.json({
      notifications: notificationsMemory.filter((n) => n.userId === userId),
    });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, userId, message, is_read FROM notifications WHERE userId = ? ORDER BY id DESC",
      [userId]
    );
    const out = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      message: r.message,
      read: !!(r.is_read),
    }));
    res.json({ notifications: out });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/notifications", async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || !message) return res.status(400).json({ message: "Missing fields" });

  try {
    const n = await addNotification(userId, message);
    res.status(201).json(n);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   HISTORY  (volunteer event history)
   ─────────────────────────────────────────────────────────── */
app.get("/history/:userId", async (req, res) => {
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

/* ──────────────────────────────────────────────────────────────
   VOLUNTEER DASHBOARD – next confirmed event
   ─────────────────────────────────────────────────────────── */
app.get("/volunteer-dashboard/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const sql = `
      SELECT e.event_id,
             e.event_name,
             e.event_description,
             e.event_location,
             e.start_time,
             e.end_time,
             GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
        FROM eventManage          e
        JOIN event_volunteer_link v  ON v.event_id = e.event_id
        LEFT JOIN event_skill     es ON es.event_id = e.event_id
        LEFT JOIN skill           s  ON s.skill_id = es.skill_id
       WHERE v.user_id = ?
         AND e.start_time > NOW()
       GROUP BY e.event_id
       ORDER BY e.start_time
       LIMIT 1`;
    const [rows] = await query(sql, [userId]);
    res.json({ next_event: rows });
  } catch (err) {
    console.error("Dashboard fetch error:", err.message); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   SUGGESTED EVENTS  (simple in-memory demo)
   ─────────────────────────────────────────────────────────── */
app.get("/suggested-events/:volunteerId", (req, res) => {
  const { volunteerId } = req.params;
  const volunteer = mockVolunteers.find((v) => v.id === Number(volunteerId));
  if (!volunteer) return res.status(404).json({ message: "Volunteer not found" });

  const matchedEvents = staticEvents
    .map((ev) => {
      const locationMatch   = ev.location === volunteer.location;
      const matchedSkills   = ev.requiredSkills.filter((s) => volunteer.skills.includes(s));
      const skillScore      = matchedSkills.length;
      const availabilityMatch =
        new Date(volunteer.availability.start) <= new Date(ev.start_time) &&
        new Date(volunteer.availability.end)   >= new Date(ev.end_time);
      const preferenceBonus = volunteer.preferences.includes(ev.preferenceTag) ? 1 : 0;
      return {
        ...ev,
        matchScore:
          (locationMatch ? 1 : 0) +
          (availabilityMatch ? 1 : 0) +
          skillScore +
          preferenceBonus,
        matchedSkills,
      };
    })
    .filter((ev) => ev.matchScore > 2)
    .sort((a, b) => b.matchScore - a.matchScore);

  if (matchedEvents.length) {
    addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].title}!`);
  }

  res.json({ suggested_events: matchedEvents });
});

/* ──────────────────────────────────────────────────────────────
   AUTH + PROFILE
   ─────────────────────────────────────────────────────────── */
// Register
app.post("/register", async (req, res) => {
  const { fullName, name, email, password } = req.body;
  const finalName = fullName || name;
  if (
    typeof finalName !== "string" || !finalName.trim() || finalName.length > 255 ||
    typeof email !== "string"     || !isValidEmail(email) || email.length > 255 ||
    typeof password !== "string"  || password.length < 6  || password.length > 255
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  try {
    const [dup] = await db.query("SELECT id FROM login WHERE email = ?", [email]);
    if (dup.length) return res.status(409).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO login (full_name, email, password) VALUES (?, ?, ?)",
      [finalName, email, hashed]
    );
    await db.query("INSERT INTO profile (user_id) VALUES (?)", [result.insertId]);
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    console.error("Register error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (
    typeof email !== "string" || !isValidEmail(email) ||
    typeof password !== "string" || !password
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM login WHERE email = ?", [email]);
    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const [profileRows] = await db.query(
      "SELECT is_complete FROM profile WHERE user_id = ?",
      [user.id]
    );
    const profileComplete = profileRows.length && profileRows[0].is_complete === 1;

    res.json({
      message: "Login successful",
      userId: user.id,
      role: user.role,
      profileComplete,
      fullName: user.full_name ?? user.name ?? null,
    });
  } catch (err) {
    console.error("Login error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

// Create / update profile
app.post("/profile", async (req, res) => {
  const {
    userId, fullName, address1, address2, city, state, zipCode,
    skills, preferences, availability,
  } = req.body;
  if (!userId) return res.status(400).json({ message: "userId required" });

  if (
    (address1    && address1.length > 100) ||
    (address2    && address2.length > 100) ||
    (city        && city.length   > 100) ||
    (state       && state.length  > 50 ) ||
    (zipCode     && zipCode.length> 10 ) ||
    (skills      && skills.length > 255) ||
    (preferences && preferences.length > 1000) ||
    (availability&& availability.length > 255)
  ) {
    return res.status(400).json({ message: "Invalid field lengths" });
  }

  try {
    await db.query(
      `INSERT INTO profile (user_id, address1, address2, city, state, zip_code,
                             preferences, availability, is_complete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         address1     = VALUES(address1),
         address2     = VALUES(address2),
         city         = VALUES(city),
         state        = VALUES(state),
         zip_code     = VALUES(zip_code),
         preferences  = VALUES(preferences),
         availability = VALUES(availability),
         is_complete  = 1`,
      [
        userId,
        address1 ?? null, address2 ?? null,
        city ?? null, state ?? null, zipCode ?? null,
        preferences ?? null, availability ?? null,
      ]
    );

    if (fullName) {
      await db.query("UPDATE login SET full_name = ? WHERE id = ?", [fullName, userId]);
    }

    /* skills array -> profile_skill link table */
    await db.query("DELETE FROM profile_skill WHERE user_id = ?", [userId]);
    const skillNames = Array.isArray(skills)
      ? skills
      : (skills || "").split(/,\s*/).filter(Boolean);

    for (const name of skillNames) {
      let [rows] = await db.query("SELECT skill_id FROM skill WHERE skill_name = ?", [name]);
      let sid;
      if (rows.length) {
        sid = rows[0].skill_id;
      } else {
        const [ins] = await db.query("INSERT INTO skill (skill_name) VALUES (?)", [name]);
        sid = ins.insertId;
      }
      await db.query("INSERT INTO profile_skill (user_id, skill_id) VALUES (?, ?)", [userId, sid]);
    }

    res.json({ message: "Profile saved" });
  } catch (err) {
    console.error("Profile save error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

// Retrieve profile
app.get("/profile/:userId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.user_id,
              l.full_name,
              p.address1, p.address2, p.city, p.state, p.zip_code,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS skills,
              p.preferences, p.availability, p.is_complete
         FROM profile p
         JOIN login  l ON l.id = p.user_id
         LEFT JOIN profile_skill ps ON ps.user_id = p.user_id
         LEFT JOIN skill s ON s.skill_id = ps.skill_id
        WHERE p.user_id = ?
        GROUP BY p.user_id`,
      [req.params.userId]
    );
    if (!rows.length) return res.status(404).json({ message: "Profile not found" });

    const row = rows[0];
    res.json({
      user_id:     row.user_id,
      fullName:    row.full_name,
      address1:    row.address1,
      address2:    row.address2,
      city:        row.city,
      state:       row.state,
      zipCode:     row.zip_code,
      skills:      row.skills ? row.skills.split(/,\s*/) : [],
      preferences: row.preferences,
      availability:row.availability,
      is_complete: row.is_complete,
    });
  } catch (err) {
    console.error("Profile fetch error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

/* ──────────────────────────────────────────────────────────────
   LOOK-UP TABLES, ADMIN HELPERS
   ─────────────────────────────────────────────────────────── */
app.get("/skills", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT skill_name FROM skill ORDER BY skill_name");
    res.json(rows.map((r) => r.skill_name));
  } catch (err) {
    console.error("Skills fetch error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/users", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT id, full_name AS name, email, role FROM login");
    res.json(rows);
  } catch (err) {
    console.error("Users list error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/users/:id/role", async (req, res) => {
  const { role } = req.body;
  if (!["user", "admin"].includes(role))
    return res.status(400).json({ message: "Invalid role" });

  try {
    await db.query("UPDATE login SET role = ? WHERE id = ?", [role, req.params.id]);
    res.json({ message: "Role updated" });
  } catch (err) {
    console.error("Role update error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/users/:id/password", async (req, res) => {
  const { password } = req.body;
  if (typeof password !== "string" || password.length < 6 || password.length > 255)
    return res.status(400).json({ message: "Invalid password" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.query("UPDATE login SET password = ? WHERE id = ?", [
      hashed,
      req.params.id,
    ]);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Password update error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM profile WHERE user_id = ?", [req.params.id]);
    await db.query("DELETE FROM login   WHERE id      = ?", [req.params.id]);
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("User delete error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});
/* 1️⃣  Admin 👉 choose a volunteer for an event
      POST /events/:eventId/requests
      Body: { volunteerId, requestedBy } */
app.post("/events/:eventId/requests", async (req, res) => {
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
       `You’ve been requested for event #${eventId}. Please accept or decline.`]
    );

    res.status(201).json({ requestId: r.insertId });
  } catch (err) {
    console.error("POST /events/:eventId/requests →", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* 2️⃣  Volunteer 👉 accept / decline
      PATCH /requests/:id
      Body: { status }   ('Accepted' | 'Declined') */
app.patch("/requests/:id", async (req, res) => {
  const { status } = req.body;                    // "Accepted" | "Declined"
  if (!["Accepted", "Declined"].includes(status))
    return res.status(400).json({ message: "Invalid status" });

  try {
    await db.query(
      `UPDATE event_volunteer_request
          SET status = ?, responded_at = NOW()
        WHERE request_id = ?`,
      [status, req.params.id]
    );

    await db.query(                                   // mark linked notification read
      `UPDATE volunteer_request_notification
          SET is_read = 1, responded_at = NOW()
        WHERE request_id = ?`,
      [req.params.id]
    );

    res.json({ message: "Status updated" });
  } catch (err) {
    console.error("PATCH /requests/:id →", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* 3️⃣  Admin view – all requests for an event
      GET /requests/event/:eventId */
app.get("/requests/event/:eventId", async (req, res) => {
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

/* 4️⃣  Volunteer view – their pending / past requests
      GET /requests/volunteer/:volunteerId */
app.get("/requests/volunteer/:volunteerId", async (req, res) => {
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

/* 5️⃣  Candidate helper – rank volunteers for an event by skill overlap
      GET /events/:eventId/candidates  (admin tool) */
app.get("/events/:eventId/candidates", async (req, res) => {
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
    res.json(rows);                                   // [{ volunteer_id, full_name, overlap, skills }]
  } catch (err) {
    console.error("GET /events/:eventId/candidates →", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* 6️⃣  Volunteer-request notifications
      GET /vr-notifications/:volunteerId */
app.get("/vr-notifications/:volunteerId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, request_id, message, is_read, created_at
         FROM volunteer_request_notification
        WHERE volunteer_id = ?
        ORDER BY created_at DESC`,
      [req.params.volunteerId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /vr-notifications/:volunteerId →", err);
    res.status(500).json({ message: "Server error" });
  }
});
export default app;
