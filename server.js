// server.js  – run locally with:  node server.js
// package.json should have  { "type": "module" }  if you want to keep import/export syntax.

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { events } from "./data/events.js";
import { volunteers as mockVolunteers } from "./data/volunteers.js";
import { volunteerHistory } from "./data/volunteerHistory.js";
dotenv.config();

const app = express();

// ───────────────────────────────────────────────────────────────
// CORS  (local Vite dev server)
// ───────────────────────────────────────────────────────────────
const corsOptions = { origin: ["http://localhost:5173"] }; // ← no trailing slash
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // pre-flight

// ───────────────────────────────────────────────────────────────
// MySQL pool  +  connectivity check
// ───────────────────────────────────────────────────────────────
const db = mysql.createPool({
  host: process.env.DB_HOST || "192.168.1.198",
  port: 3306,
  user: process.env.DB_USER || "Leo",
  password: process.env.DB_PASSWORD || "Test=123!",
  database: process.env.DB_NAME || "COSC4353",
  connectionLimit: 5,
});

const USE_DB =
  String(process.env.USE_DB || "").toLowerCase() === "1" ||
  String(process.env.USE_DB || "").toLowerCase() === "true";

const query = async (sql, params) => {
  const [results] = await db.execute(sql, params);
  return results;
};

let notificationsMemory = [
  { id: 1, userId: 1, message: "Event A", read: false },
  { id: 2, userId: 1, message: "Event B", read: false },
  { id: 3, userId: 2, message: "Event C", read: false },
];

async function addNotification(userId, message) {
  if (!USE_DB) {
    const n = { id: Date.now(), userId: Number(userId), message, read: false };
    notificationsMemory.push(n);
    return n;
  }
  await db.query(
    "INSERT INTO notifications (userId, message, is_read) VALUES (?, ?, ?)",
    [Number(userId), message, 0]
  );
  return { userId: Number(userId), message, read: false };
}

// Ping once to verify connectivity
(async () => {
  try {
    const conn = await db.getConnection();
    await conn.ping();
    console.log("✅  MySQL connection pool ready (ping OK)");
    conn.release();
  } catch (err) {
    console.error("❌  MySQL connection failed:", err.message);
    // Optionally:   process.exit(1);
  }
})();

// ───────────────────────────────────────────────────────────────
// Express middleware
// ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Log every incoming request
app.use((req, res, next) => {
  console.log(`Incoming ${req.method} request to ${req.url}`);
  next();
});

// Event routes
app.post("/events", async (req, res) => {
  console.log("2. Backend: Received Request Body", req.body);
  const {
    eventName,
    eventDescription,
    location,
    skills,
    urgency,
    eventDate,
    userId,
  } = req.body;

  if (!userId) return res.status(400).json({ message: "userId required" });

  try {
    await db.query(
      `INSERT INTO eventManage (user_id, eventName, eventDescription, location, skills, urgency, eventDate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        eventName || null,
        eventDescription || null,
        location || null,
        skills || null,
        urgency || null,
        eventDate || null,
      ]
    );

    res.status(200).json({ message: "Event saved" });
  } catch (err) {
    console.error("Event save error:", err);
    res.status(500).json({ message: "Server error", error: err });
  }
});

app.get("/events/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const [rows] = await db.query(
      "SELECT * FROM eventManage WHERE user_id = ?",
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Volunteer matching
app.get("/api/match/:volunteerId", async (req, res) => {
  const { volunteerId } = req.params;

  try {
    let volunteer;
    if (USE_DB) {
      const [rows] = await db.query(
        `SELECT id, location, skills, preferences, availability_start, availability_end
         FROM volunteers WHERE id = ?`,
        [volunteerId]
      );
      if (!rows.length) {
        return res.status(404).json({ message: "Volunteer not found" });
      }
      volunteer = rows[0];
      volunteer.skills = (volunteer.skills || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      volunteer.preferences = (volunteer.preferences || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      volunteer.availability = {
        start: volunteer.availability_start,
        end: volunteer.availability_end,
      };
    } else {
      volunteer = mockVolunteers.find(
        (v) => String(v.id) === String(volunteerId)
      );
      if (!volunteer) {
        return res.status(404).json({ message: "Volunteer not found" });
      }
    }

    const matchedEvents = events
      .map((ev) => {
        const locationMatch = ev.location === volunteer.location;

        const matchedSkills = ev.requiredSkills.filter((skill) =>
          (volunteer.skills || []).includes(skill)
        );
        const skillScore = matchedSkills.length;

        const availabilityMatch =
          new Date(volunteer.availability?.start) <= new Date(ev.startTime) &&
          new Date(volunteer.availability?.end) >= new Date(ev.endTime);

        const preferenceBonus = (volunteer.preferences || []).includes(
          ev.preferenceTag
        )
          ? 1
          : 0;

        const matchScore =
          (locationMatch ? 1 : 0) +
          (availabilityMatch ? 1 : 0) +
          skillScore +
          preferenceBonus;

        return { ...ev, matchScore, matchedSkills };
      })
      .filter((ev) => ev.matchScore > 2)
      .sort((a, b) => b.matchScore - a.matchScore);

    if (matchedEvents.length > 0) {
      const top = matchedEvents[0];
      const message = `You've been matched to ${top.title}!`;
      await addNotification(volunteer.id, message);
    }

    return res.json(matchedEvents);
  } catch (err) {
    console.error("Error matching volunteer:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Notifications
app.get("/api/notifications", async (_req, res) => {
  if (!USE_DB) return res.json(notificationsMemory);

  try {
    const [rows] = await db.query(
      "SELECT id, userId, message, is_read FROM notifications ORDER BY id DESC"
    );
    const out = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      message: r.message,
      read: !!(r.read ?? r.is_read),
    }));
    return res.json(out);
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/notifications/:userId", async (req, res) => {
  const id = Number(req.params.userId);
  if (!USE_DB)
    return res.json(notificationsMemory.filter((n) => n.userId === id));

  try {
    const [rows] = await db.query(
      "SELECT id, userId, message, is_read FROM notifications WHERE userId = ? ORDER BY id DESC",
      [id]
    );
    const out = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      message: r.message,
      read: !!(r.read ?? r.is_read),
    }));
    return res.json(out);
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/notifications", async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || !message)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const n = await addNotification(userId, message);
    return res.status(201).json(n);
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

// History routes
app.get("/history", (req, res) => {
  res.json(volunteerHistory);
});

app.get("/history/:userID", async (req, res) => {
  try {
    const volunteer_id = req.params.userID;
    const sql =
      "SELECT vh.history_id, em.event_id, em.event_name, em.event_description, em.event_location, em.start_time, vh.event_status, em.urgency, GROUP_CONCAT(sk.skill_name) AS skills FROM volunteer_history AS vh JOIN eventManage AS em ON vh.event_id = em.event_id JOIN event_skill AS ek ON em.event_id = ek.event_id JOIN skill AS sk ON ek.skill_id = sk.skill_id WHERE vh.volunteer_id = ? GROUP BY vh.history_id, em.event_id;";
    const volunteer_history = await query(sql, [volunteer_id]);

    res.status(200).json({ volunteer_history });
  } catch (error) {
    console.error("Error fetching volunteer's history ", error.message);
    res
      .status(500)
      .json({ message: "Server error fetching volunteer's history" });
  }
});

// Volunteer dashboard
app.get("/volunteer-dashboard/:userID", async (req, res) => {
  try {
    const volunteerID = req.params.userID;
    const sql =
      "SELECT l.full_name, em.event_id, em.event_name,em.start_time, em.end_time, em.event_location, em.event_description FROM login AS l JOIN volunteer_history AS vh ON l.id = vh.volunteer_id JOIN eventManage AS em ON vh.event_id = em.event_id WHERE l.id = ? AND em.start_time > NOW() ORDER BY em.start_time ASC LIMIT 1;";

    const next_event = await query(sql, [volunteerID]);

    res.status(200).json({ next_event });
  } catch (error) {
    console.error(
      "Error fetching volunteer's history (Backend)",
      error.message
    );
    res
      .status(500)
      .json({ message: "Server error fetching volunteer's next event" });
  }
});

// Starts the server on port 3000 by default
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Register
app.post("/register", async (req, res) => {
  const { fullName, name, email, password } = req.body;
  const finalName = fullName || name;
  if (
    typeof finalName !== "string" ||
    !finalName.trim() ||
    finalName.length > 255 ||
    typeof email !== "string" ||
    !isValidEmail(email) ||
    email.length > 255 ||
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 255
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  try {
    console.log("Register attempt:", { name: finalName, email });

    const [dup] = await db.query("SELECT id FROM login WHERE email = ?", [
      email,
    ]);
    if (dup.length)
      return res.status(409).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO login (full_name, email, password) VALUES (?, ?, ?)",
      [finalName, email, hashed]
    );
    await db.query("INSERT INTO profile (user_id) VALUES (?)", [
      result.insertId,
    ]);

    console.log("Inserted user id:", result.insertId);
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (
    typeof email !== "string" ||
    !isValidEmail(email) ||
    typeof password !== "string" ||
    !password
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM login WHERE email = ?", [
      email,
    ]);
    if (!rows.length)
      return res.status(401).json({ message: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const [profileRows] = await db.query(
      "SELECT is_complete FROM profile WHERE user_id = ?",
      [user.id]
    );
    const profileComplete =
      profileRows.length && profileRows[0].is_complete === 1;

    res.json({
      message: "Login successful",
      userId: user.id,
      role: user.role,
      profileComplete,
      fullName: user.full_name ?? user.name ?? null,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Create / update profile
app.post("/profile", async (req, res) => {
  const {
    userId,
    fullName,
    address1,
    address2,
    city,
    state,
    zipCode,
    skills,
    preferences,
    availability,
  } = req.body;
  if (!userId) return res.status(400).json({ message: "userId required" });

  if (
    (address1 && address1.length > 100) ||
    (address2 && address2.length > 100) ||
    (city && city.length > 100) ||
    (state && state.length > 50) ||
    (zipCode && zipCode.length > 10) ||
    (skills && skills.length > 255) ||
    (preferences && preferences.length > 1000) ||
    (availability && availability.length > 255)
  ) {
    return res.status(400).json({ message: "Invalid field lengths" });
  }

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
        address1 || null,
        address2 || null,
        city || null,
        state || null,
        zipCode || null,
        preferences || null,
        availability || null,
      ]
    );

    if (fullName) {
      await db.query("UPDATE login SET full_name = ? WHERE id = ?", [
        fullName,
        userId,
      ]);
    }

    await db.query("DELETE FROM profile_skill WHERE user_id = ?", [userId]);
    const skillNames = Array.isArray(skills)
      ? skills
      : (skills || "").split(/,\s*/).filter((s) => s);
    for (const name of skillNames) {
      let [rows] = await db.query(
        "SELECT skill_id FROM skill WHERE skill_name = ?",
        [name]
      );
      let sid;
      if (rows.length) {
        sid = rows[0].skill_id;
      } else {
        const [res2] = await db.query(
          "INSERT INTO skill (skill_name) VALUES (?)",
          [name]
        );
        sid = res2.insertId;
      }
      await db.query(
        "INSERT INTO profile_skill (user_id, skill_id) VALUES (?, ?)",
        [userId, sid]
      );
    }

    res.json({ message: "Profile saved" });
  } catch (err) {
    console.error("Profile save error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Retrieve profile
app.get("/profile/:userId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.user_id,
              l.full_name AS fullName,
              p.address1,
              p.address2,
              p.city,
              p.state,
              p.zip_code,
              GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS skills,
              p.preferences,
              p.availability,
              p.is_complete
         FROM profile p
         JOIN login l ON l.id = p.user_id
         LEFT JOIN profile_skill ps ON ps.user_id = p.user_id
         LEFT JOIN skill s ON s.skill_id = ps.skill_id
        WHERE p.user_id = ?
        GROUP BY p.user_id`,
      [req.params.userId]
    );
    if (!rows.length)
      return res.status(404).json({ message: "Profile not found" });
    const row = rows[0];
    const skills = row.skills ? row.skills.split(/,\s*/) : [];
    res.json({
      user_id: row.user_id,
      fullName: row.fullName,
      address1: row.address1,
      address2: row.address2,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
      skills,
      preferences: row.preferences,
      availability: row.availability,
      is_complete: row.is_complete,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin utilities
app.get("/users", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, full_name AS name, email, role FROM login"
      //                ^^^^^^^^^^^^^^^ alias keeps front-end unchanged
    );
    res.json(rows);
  } catch (err) {
    console.error("Users list error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
app.put("/users/:id/role", async (req, res) => {
  const { role } = req.body;
  if (!["user", "admin"].includes(role))
    return res.status(400).json({ message: "Invalid role" });

  try {
    await db.query("UPDATE login SET role = ? WHERE id = ?", [
      role,
      req.params.id,
    ]);
    res.json({ message: "Role updated" });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/users/:id/password", async (req, res) => {
  const { password } = req.body;
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 255
  )
    return res.status(400).json({ message: "Invalid password" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.query("UPDATE login SET password = ? WHERE id = ?", [
      hashed,
      req.params.id,
    ]);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM profile WHERE user_id = ?", [req.params.id]);
    await db.query("DELETE FROM login WHERE id = ?", [req.params.id]);
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("User delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default app;
