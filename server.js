// server.js  – run locally with:  node server.js
// package.json should have  { "type": "module" }  if you want to keep import/export syntax.

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import eventRoutes from "./routes/eventRoutes.js";
import matchRoutes from "./routes/match.js";
import notificationRoutes from './routes/notifications.js';
import historyRoutes from "./routes/historyRoutes.js";
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
  host: process.env.DB_HOST || "104.10.143.45",
  port: 3306,
  user: process.env.DB_USER || "your_username",
  password: process.env.DB_PASSWORD || "your_password",
  database: process.env.DB_NAME || "your_database",
  connectionLimit: 5,
});

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

// Using the event routes

//ISHAN VOLUNTEER MATCHING TEST
app.use('/api/match', matchRoutes);

//ISHAN NOTIFCATION TEST
app.use('/api/notifications', notificationRoutes);

// Starts the server on port 3000
app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});

// ───────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────

app.use("/", eventRoutes);
app.use("/history", historyRoutes);

// Register
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 255 ||
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
    console.log("Register attempt:", { name, email });

    const [dup] = await db.query("SELECT id FROM login WHERE email = ?", [
      email,
    ]);
    if (dup.length)
      return res.status(409).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO login (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashed]
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
      `INSERT INTO profile (user_id, address1, address2, city, state, zip_code, skills, preferences, availability, is_complete)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
                              address1     = VALUES(address1),
                              address2     = VALUES(address2),
                              city         = VALUES(city),
                              state        = VALUES(state),
                              zip_code     = VALUES(zip_code),
                              skills       = VALUES(skills),
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
        skills || null,
        preferences || null,
        availability || null,
      ]
    );
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
      `SELECT user_id, address1, address2, city, state, zip_code, skills, preferences, availability, is_complete
             FROM profile WHERE user_id = ?`,
      [req.params.userId]
    );
    if (!rows.length)
      return res.status(404).json({ message: "Profile not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Retrieve Event
app.get("/events/:userId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT user_id, eventName, eventDescription, location, skills, urgency
              FROM eventManage WHERE user_id = ?`,
      [req.params.userId]
    );
    if (!rows.length)
      return res.status(404).json({ message: "Event not found" });
    res.json(rows[0]);
  } catch (err) {
    console.log("Event fetch error:", err);
    res.status(500).json({ message: "Event error" });
  }
});


// Admin utilities
app.get("/users", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name, email, role FROM login");
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

export default app;
