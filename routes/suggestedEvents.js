import express from "express";
import { addNotification } from "../utils/notifications.js";
import { mockVolunteers, staticEvents } from "../memory.js";

const router = express.Router();

router.get("/suggested-events/:volunteerId", (req, res) => {
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
    addNotification(volunteer.id, `You've been matched to ${matchedEvents[0].title}!`);
  }

  res.json({ suggested_events: matchedEvents });
});

export default router;
