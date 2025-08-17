// server/server.js - Core application setup
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

// Import database utilities
import { db, USE_DB, query } from './db.js';

// Import route modules
import eventRoutes from './routes/eventRoutes.js';
import matchRoutes from './routes/match.js';
import notificationRoutes from './routes/notifications.js';
import historyRoutes from './routes/historyRoutes.js';
import vDashRoutes from './routes/vDashRoutes.js';

dotenv.config();

const app = express();

/* ──────────────────────────────────────────────────────────────
   CORS  (adjust the origin list to suit your front-end hosts)
   ─────────────────────────────────────────────────────────── */
const corsOptions = { origin: ["http://localhost:5173"] };
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // pre-flight

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
let notificationsMemory = [];                  // simple in-RAM inbox

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
   AUTH ENDPOINTS (wired directly)
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

// Save profile
app.post("/profile", async (req, res) => {
  const { userId, fullName, address1, address2, city, state, zipCode, skills, preferences, availability } = req.body;
  if (!userId) return res.status(400).json({ message: "Missing userId" });

  try {
    await db.query(
      `INSERT INTO profile (user_id, address1, address2, city, state, zip_code, preferences, availability, is_complete)
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
   MOUNT ROUTE MODULES
   ─────────────────────────────────────────────────────────── */
app.use('/events', eventRoutes);
app.use('/api/match', matchRoutes);
app.use('/notifications', notificationRoutes);
app.use('/history', historyRoutes);
app.use('/volunteer-dashboard', vDashRoutes);

// Handle requests endpoints separately to avoid conflicts
app.get('/requests/event/:eventId', async (req, res) => {
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

app.get('/requests/volunteer/:volunteerId', async (req, res) => {
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

app.patch('/requests/:id', async (req, res) => {
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

/* ──────────────────────────────────────────────────────────────
   ADDITIONAL DIRECT ENDPOINTS (lookup tables, admin helpers, etc.)
   ─────────────────────────────────────────────────────────── */

// Reports endpoints
app.get("/reports/event-summary", async (req, res) => {
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
     ORDER BY e.start_time
  `;

  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("event-summary error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/reports/volunteer-activity", async (req, res) => {
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
        CASE WHEN e.start_time < NOW() AND e.end_time < NOW() 
        THEN TIMESTAMPDIFF(HOUR, e.start_time, e.end_time) 
        ELSE 0 END
      ) AS hours
    FROM volunteer_history h
    JOIN login l ON l.id = h.volunteer_id
    JOIN eventManage e ON e.event_id = h.event_id
    WHERE ${where.join(" AND ")}
    GROUP BY h.volunteer_id
    ORDER BY events DESC, hours DESC
  `;

  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("volunteer-activity error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/reports/volunteer-activity/by-event", async (req, res) => {
  const { start, end, urgency = "All", status = "All" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });

  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];

  if (urgency && urgency !== "All") { where.push("e.urgency = ?"); args.push(urgency); }
  if (status  && status  !== "All") { where.push("h.event_status = ?"); args.push(status); }

  const sql = `
    SELECT
      e.event_id,
      e.event_name,
      e.event_location,
      e.start_time,
      e.urgency,
      h.event_status,
      COUNT(DISTINCT h.volunteer_id) AS volunteers,
      TIMESTAMPDIFF(HOUR, e.start_time, e.end_time) AS event_hours
    FROM eventManage e
    JOIN volunteer_history h ON h.event_id = e.event_id
    WHERE ${where.join(" AND ")}
    GROUP BY e.event_id
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

app.get("/reports/volunteer-activity/timeseries", async (req, res) => {
  const { start, end, urgency = "All", status = "All" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });

  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];

  if (urgency && urgency !== "All") { where.push("e.urgency = ?"); args.push(urgency); }
  if (status  && status  !== "All") { where.push("h.event_status = ?"); args.push(status); }

  const sql = `
    SELECT
      DATE(e.start_time) AS event_date,
      COUNT(DISTINCT h.volunteer_id) AS volunteers,
      COUNT(DISTINCT e.event_id) AS events,
      SUM(TIMESTAMPDIFF(HOUR, e.start_time, e.end_time)) AS total_hours
    FROM eventManage e
    JOIN volunteer_history h ON h.event_id = e.event_id
    WHERE ${where.join(" AND ")}
    GROUP BY DATE(e.start_time)
    ORDER BY event_date
  `;

  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("volunteer-activity/timeseries error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/reports/top-volunteers", async (req, res) => {
  const { start, end, urgency = "All", limit = "10" } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start & end required" });

  const where = ["e.start_time BETWEEN ? AND ?"];
  const args  = [start, `${end} 23:59:59`];

  if (urgency && urgency !== "All") { where.push("e.urgency = ?"); args.push(urgency); }

  const sql = `
    SELECT
      h.volunteer_id,
      l.full_name,
      COUNT(DISTINCT h.event_id) AS events,
      SUM(TIMESTAMPDIFF(HOUR, e.start_time, e.end_time)) AS total_hours
    FROM volunteer_history h
    JOIN login l ON l.id = h.volunteer_id
    JOIN eventManage e ON e.event_id = h.event_id
    WHERE ${where.join(" AND ")}
      AND h.event_status IN ('Attended', 'Upcoming')
    GROUP BY h.volunteer_id
    ORDER BY total_hours DESC, events DESC
    LIMIT ?
  `;
  args.push(parseInt(limit, 10));

  try {
    const [rows] = await db.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("top-volunteers error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Legacy suggested events endpoint (in-memory only)
app.get("/suggested-events/:volunteerId", (req, res) => {
  const { volunteerId } = req.params;
  const mockVolunteers = []; // This would need to be populated
  const staticEvents = [];   // This would need to be populated
  
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

// Get candidate volunteers for an event (admin feature)
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
    res.json(rows);
  } catch (err) {
    console.error("GET /events/:eventId/candidates →", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Volunteer request notifications
app.get("/vr-notifications/:volunteerId", async (req, res) => {
  const { volunteerId } = req.params;
  const showAll = String(req.query.all || "") === "1";

  try {
    const where = [`vrn.volunteer_id = ?`];
    const args  = [volunteerId];

    if (!showAll) {
      // Only show unread + pending
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

// Simple server time endpoint (no caching)
app.get("/time", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ serverIso: new Date().toISOString() });
});

export default app;