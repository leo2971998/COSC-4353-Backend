import express from "express";
import { db, USE_DB } from "../config/db.js";
import { notificationsMemory } from "../memory.js";
import { addNotification } from "../utils/notifications.js";

const router = express.Router();

router.get("/notifications", async (_req, res) => {
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

router.get("/notifications/:userId", async (req, res) => {
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

router.post("/notifications", async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || !message) return res.status(400).json({ message: "Missing fields" });
  try {
    const n = await addNotification(userId, message);
    res.status(201).json(n);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
