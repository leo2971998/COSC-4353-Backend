import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const app = express();

// CORS
const corsOptions = { origin: ["http://localhost:5173"] };
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// MySQL pool
const db = mysql.createPool({
  host: process.env.DB_HOST || "192.168.1.198",
  port: 3306,
  user: process.env.DB_USER || "Leo",
  password: process.env.DB_PASSWORD || "Test=123!",
  database: process.env.DB_NAME || "COSC4353",
  connectionLimit: 5,
});
(async () => {
  try {
    const conn = await db.getConnection();
    await conn.ping();
    console.log("✅  MySQL connection pool ready (ping OK)");
    conn.release();
  } catch (err) {
    console.error("❌  MySQL connection failed:", err.message);
  }
})();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EVENTS API
let eventsCache = [];
app.get("/events", async (_req, res) => {
  try {
    const sql = `
      SELECT e.event_id,
             e.event_name,
             e.event_description,
             e.event_location,
             e.urgency,
             e.start_time,
             e.end_time,
             GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
        FROM eventManage      e
        LEFT JOIN event_skill es ON es.event_id = e.event_id
        LEFT JOIN skill       s  ON s.skill_id  = es.skill_id
       GROUP BY e.event_id`;
    const [events] = await db.query(sql);
    eventsCache = events;
    res.json({ events });
  } catch (err) {
    console.error("Error fetching events:", err.message);
    if (eventsCache.length) return res.json({ events: eventsCache });
    res.status(500).json({ message: "Error fetching events" });
  }
});

app.post("/events", async (req, res) => {
  const {
    event_name,
    event_description,
    event_location,
    urgency,
    start_time,
    end_time,
  } = req.body;

  if (!event_name || !start_time || !end_time) {
    return res
      .status(400)
      .json({ message: "event_name, start_time, end_time required" });
  }

  try {
    const sql = `INSERT INTO eventManage
                   (event_name, event_description, event_location,
                    urgency, start_time, end_time)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    const [result] = await db.query(sql, [
      event_name,
      event_description ?? null,
      event_location ?? null,
      urgency ?? null,
      start_time,
      end_time,
    ]);
    const newEvent = { event_id: result.insertId, ...req.body };
    res.status(201).json({ message: "Event created", event: newEvent });
  } catch (err) {
    console.error("Error creating event:", err.message);
    res.status(500).json({ message: "Error creating event" });
  }
});

// Auth helpers
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

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
              l.full_name,
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
    const skillsArr = row.skills ? row.skills.split(/,\s*/) : [];
    res.json({
      user_id: row.user_id,
      fullName: row.full_name,
      address1: row.address1,
      address2: row.address2,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
      skills: skillsArr,
      preferences: row.preferences,
      availability: row.availability,
      is_complete: row.is_complete,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// List all skills
app.get("/skills", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT skill_name FROM skill ORDER BY skill_name"
    );
    const names = rows.map((r) => r.skill_name);
    res.json(names);
  } catch (err) {
    console.error("Skills fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Admin utilities
app.get("/users", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, full_name AS name, email, role FROM login"
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

// Volunteer dashboard – next confirmed event
app.get("/volunteer-dashboard/:userId", async (req, res) => {
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
         FROM eventManage          e
         JOIN event_volunteer_link v ON v.event_id = e.event_id
         LEFT JOIN event_skill     es ON es.event_id = e.event_id
         LEFT JOIN skill           s  ON s.skill_id  = es.skill_id
        WHERE v.user_id = ?
          AND e.start_time > NOW()
        GROUP BY e.event_id
        ORDER BY e.start_time
        LIMIT 1`,
      [userId]
    );
    res.json({ next_event: rows });
  } catch (err) {
    console.error("Next-event fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Suggested events (match) – inline implementation
app.get("/suggested-events/:volunteerId", (req, res) => {
  const { volunteerId } = req.params;
  const volunteer = volunteers.find((v) => v.id === volunteerId);
  if (!volunteer) {
    return res.status(404).json({ message: "Volunteer not found" });
  }

  const matchedEvents = staticEvents
    .map((event) => {
      const locationMatch = event.location === volunteer.location;
      const matchedSkills = event.requiredSkills.filter((skill) =>
        volunteer.skills.includes(skill)
      );
      const skillScore = matchedSkills.length;
      const availabilityMatch =
        new Date(volunteer.availability.start) <= new Date(event.startTime) &&
        new Date(volunteer.availability.end) >= new Date(event.endTime);
      const preferenceBonus = volunteer.preferences.includes(event.preferenceTag)
        ? 1
        : 0;
      const matchScore =
        (locationMatch ? 1 : 0) +
        (availabilityMatch ? 1 : 0) +
        skillScore +
        preferenceBonus;
      return {
        ...event,
        matchScore,
        matchedSkills,
      };
    })
    .filter((event) => event.matchScore > 2)
    .sort((a, b) => b.matchScore - a.matchScore);

  if (matchedEvents.length > 0) {
    addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].title}!`);
  }

  res.json({ suggested_events: matchedEvents });
});

// Notifications – inline endpoints
app.get("/notifications", (_req, res) => {
  res.json({ notifications });
});

app.get("/notifications/:userId", (req, res) => {
  const { userId } = req.params;
  const userNotifications = notifications.filter(
    (n) => n.userId === parseInt(userId)
  );
  res.json({ notifications: userNotifications });
});

app.post("/notifications", (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ message: "Missing fields" });
  }
  const newNotification = {
    id: Date.now(),
    userId: parseInt(userId),
    message,
    read: false,
  };
  notifications.push(newNotification);
  res.status(201).json(newNotification);
});

export default app;
