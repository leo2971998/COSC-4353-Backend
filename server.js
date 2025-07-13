import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const corsOptions = {
  origin: ["http://localhost:5173"], // ← no trailing slash
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle pre-flight globally

// ---------------------------------------------------------------------------
// MySQL connection pool + connectivity check
// ---------------------------------------------------------------------------
const db = mysql.createPool({
  host: process.env.DB_HOST || "104.10.143.45",
  port: 3306,
  user: process.env.DB_USER || "your_username",
  password: process.env.DB_PASSWORD || "your_password",
  database: process.env.DB_NAME || "your_database",
  connectionLimit: 5,               // good default for local dev
});

(async () => {
  try {
    const conn = await db.getConnection();
    await conn.ping();
    console.log("✅  MySQL connection pool established (ping ok)");
    conn.release();
  } catch (err) {
    console.error("❌  Unable to connect to MySQL:", err.message);
  }
})();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
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
    const [rows] = await db.query("SELECT id FROM login WHERE email = ?", [email]);
    if (rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO login (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashed]
    );
    await db.query("INSERT INTO profile (user_id) VALUES (?)", [result.insertId]);

    console.log("Inserted user id:", result.insertId);
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (
    typeof email !== "string" ||
    !isValidEmail(email) ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    return res.status(400).json({ message: "Invalid input" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM login WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ message: "Login successful", userId: user.id });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Create / update profile
// ─────────────────────────────────────────────────────────────────────────────
app.post("/profile", async (req, res) => {
  const { userId, location, skills, preferences, availability } = req.body;
  if (!userId) {
    return res.status(400).json({ message: "userId required" });
  }
  if (
    (location && location.length > 255) ||
    (skills && skills.length > 255) ||
    (preferences && preferences.length > 1000) ||
    (availability && availability.length > 255)
  ) {
    return res.status(400).json({ message: "Invalid field lengths" });
  }

  try {
    await db.query(
      `INSERT INTO profile (user_id, location, skills, preferences, availability)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         location     = VALUES(location),
         skills       = VALUES(skills),
         preferences  = VALUES(preferences),
         availability = VALUES(availability)`,
      [userId, location || null, skills || null, preferences || null, availability || null]
    );
    res.json({ message: "Profile saved" });
  } catch (err) {
    console.error("Profile save error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Retrieve profile
// ─────────────────────────────────────────────────────────────────────────────
app.get("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT user_id, location, skills, preferences, availability FROM profile WHERE user_id = ?",
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin utilities
// ─────────────────────────────────────────────────────────────────────────────
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
  const { id } = req.params;
  const { role } = req.body;
  if (!["user", "admin"].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  try {
    await db.query("UPDATE login SET role = ? WHERE id = ?", [role, id]);
    res.json({ message: "Role updated" });
  } catch (err) {
    console.error("Role update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/users/:id/password", async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (typeof password !== "string" || password.length < 6 || password.length > 255) {
    return res.status(400).json({ message: "Invalid password" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.query("UPDATE login SET password = ? WHERE id = ?", [hashed, id]);
    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
export default app;
