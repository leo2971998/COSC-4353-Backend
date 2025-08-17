import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../config/db.js";

const router = express.Router();

router.get("/skills", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT skill_name FROM skill ORDER BY skill_name");
    res.json(rows.map((r) => r.skill_name));
  } catch (err) {
    console.error("Skills fetch error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT id, full_name AS name, email, role FROM login");
    res.json(rows);
  } catch (err) {
    console.error("Users list error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/users/:id/role", async (req, res) => {
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

router.put("/users/:id/password", async (req, res) => {
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

router.delete("/users/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM profile WHERE user_id = ?", [req.params.id]);
    await db.query("DELETE FROM login   WHERE id      = ?", [req.params.id]);
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("User delete error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
