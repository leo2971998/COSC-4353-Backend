// server/controllers/notificationsController.js - Handles notification storage (DB or in-memory)
import { db, USE_DB, query } from '../db.js';

// In-memory fallback for non-DB mode
let notificationsMemory = [];

export const addNotification = async (userId, message) => {
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

export const getAllNotifications = async (req, res) => {
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
};

export const getNotificationsByUser = async (req, res) => {
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
};

export const createNotification = async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || !message) return res.status(400).json({ message: "Missing fields" });

  try {
    const n = await addNotification(userId, message);
    res.status(201).json(n);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getVolunteerRequestNotifications = async (req, res) => {
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
};