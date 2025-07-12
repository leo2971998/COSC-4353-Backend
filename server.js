import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const corsOptions = {
  // Origin: This is the frontend URL that will be allowed to access the server.
  origin: ["http://localhost:5173/"],
};

// Create a connection pool to the MySQL database
const db = mysql.createPool({
  host: process.env.DB_HOST || "104.10.143.45",
  port: 3306,
  user: process.env.DB_USER || "your_username",
  password: process.env.DB_PASSWORD || "your_password",
  database: process.env.DB_NAME || "your_database",
});

// Allows us to parse JSON data in the request body.
app.use(express.json());

// Allows us to parse URL-encoded data (from HTML forms or URL-style strings). extended allows us to parse nested objects
app.use(express.urlencoded({ extended: true }));

// Use the CORS middleware with the specific options we defined.
app.use(cors(corsOptions));

// Register a new user
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "name, email and password required" });
  }
  try {
    const [rows] = await db.query("SELECT id FROM login WHERE email = ?", [
      email,
    ]);
    if (rows.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO login (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashed]
    );
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Authenticate a user
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "email and password required" });
  }
  try {
    const [rows] = await db.query("SELECT * FROM login WHERE email = ?", [
      email,
    ]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    res.json({ message: "Login successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  // Only start the server locally. Vercel provides the listener in production.
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;
