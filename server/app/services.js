// server/app/services.js - Business logic services separated from route wiring
import { db, USE_DB, query } from '../db.js';

export const eventService = {
  async getAllEvents() {
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
    return rows;
  },

  async getEventById(eventId) {
    const [rows] = await db.query(
      `SELECT  e.event_id,
               e.event_name,
               e.event_description,
               e.event_location,
               e.urgency,
               e.start_time,
               e.end_time,
               GROUP_CONCAT(s.skill_name ORDER BY s.skill_name) AS required_skills
         FROM  eventManage e
         LEFT JOIN event_skill es ON es.event_id = e.event_id
         LEFT JOIN skill s ON s.skill_id = es.skill_id
        WHERE  e.event_id = ?
        GROUP BY e.event_id`,
      [eventId]
    );
    return rows[0] || null;
  }
};

export const profileService = {
  async getProfile(userId) {
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
      [userId]
    );
    
    if (!rows.length) return null;
    
    const row = rows[0];
    return {
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
    };
  }
};

export const notificationService = {
  async addNotification(userId, message) {
    if (!USE_DB) {
      // In-memory fallback
      return { id: Date.now(), userId: Number(userId), message, read: false };
    }
    await query(
      "INSERT INTO notifications (userId, message, is_read) VALUES (?, ?, ?)",
      [Number(userId), message, 0]
    );
    return { id: undefined, userId: Number(userId), message, read: false };
  },

  async getNotificationsByUser(userId) {
    if (!USE_DB) {
      // In-memory fallback would need to be implemented
      return [];
    }
    
    const [rows] = await db.query(
      "SELECT id, userId, message, is_read FROM notifications WHERE userId = ? ORDER BY id DESC",
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      message: r.message,
      read: !!(r.is_read),
    }));
  }
};