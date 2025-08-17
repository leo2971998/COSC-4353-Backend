import express from "express";
import { db, USE_DB } from "../../config/db.js";
import { addNotification } from "../../utils/notifications.js";
import { getEventsMemory, mockVolunteers, staticEvents } from "../../memory.js";

const router = express.Router();

router.get("/api/match/:volunteerId", async (req, res) => {
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

    const sourceEvents = USE_DB ? getEventsMemory() : staticEvents;
    const matchedEvents = sourceEvents
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
});

export default router;
