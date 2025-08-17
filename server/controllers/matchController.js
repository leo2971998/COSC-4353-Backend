// server/controllers/matchController.js - Scoring algorithm that ranks upcoming events for a volunteer
import { db, USE_DB, query } from '../db.js';

// In-memory fallbacks for non-DB mode
const mockVolunteers = [];
const staticEvents = [];
let eventsMemory = [];

// Notification helper
const addNotification = async (userId, message) => {
  if (!USE_DB) {
    // This would need to be imported from a notifications service in a more complete refactor
    return { id: Date.now(), userId: Number(userId), message, read: false };
  }
  await query(
    "INSERT INTO notifications (userId, message, is_read) VALUES (?, ?, ?)",
    [Number(userId), message, 0]
  );
  return { id: undefined, userId: Number(userId), message, read: false };
};

export const getMatchedEventsForVolunteer = async (req, res) => {
  const { volunteerId } = req.params;

  try {
    let volunteer;
    if (USE_DB) {
      const [rows] = await db.query(
        `SELECT id, location, skills, preferences,
                availability_start, availability_end
           FROM volunteers
          WHERE id = ?`,
        [volunteerId]
      );
      if (!rows.length) return res.status(404).json({ message: "Volunteer not found" });

      volunteer = rows[0];
      volunteer.skills       = (volunteer.skills       || "").split(",").map((s) => s.trim()).filter(Boolean);
      volunteer.preferences  = (volunteer.preferences  || "").split(",").map((s) => s.trim()).filter(Boolean);
      volunteer.availability = {
        start: volunteer.availability_start,
        end:   volunteer.availability_end,
      };
    } else {
      volunteer = mockVolunteers.find((v) => String(v.id) === String(volunteerId));
      if (!volunteer) return res.status(404).json({ message: "Volunteer not found" });
    }

    // When not using DB, `events` is the in-memory array you manage elsewhere.
    const matchedEvents = (USE_DB ? eventsMemory : staticEvents)
      .map((ev) => {
        const locationMatch   = ev.event_location === volunteer.location;
        const matchedSkills   = (ev.required_skills || "").split(",").filter((s) => volunteer.skills.includes(s));
        const skillScore      = matchedSkills.length;
        const availabilityMatch =
          new Date(volunteer.availability?.start) <= new Date(ev.start_time) &&
          new Date(volunteer.availability?.end)   >= new Date(ev.end_time);
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
      await addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].event_name}!`);
    }

    res.json(matchedEvents);
  } catch (err) {
    console.error("Match error:", err); // eslint-disable-line no-console
    res.status(500).json({ message: "Server error" });
  }
};

export const getSuggestedEventsForVolunteer = async (req, res) => {
  const { volunteerId } = req.params;
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
    await addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].title}!`);
  }

  res.json({ suggested_events: matchedEvents });
};

export const getCandidatesForEvent = async (req, res) => {
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
};