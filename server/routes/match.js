// server/routes/match.js – Volunteer-event matching
import express from 'express';
import { 
  getMatchedEventsForVolunteer, 
  getSuggestedEventsForVolunteer,
  getCandidatesForEvent 
} from '../controllers/matchController.js';

const router = express.Router();

// Main API endpoint for volunteer matching
router.get('/:volunteerId', getMatchedEventsForVolunteer);

// Legacy suggested events endpoint (in-memory only) - mount this at root level
// This will be handled in server.js as /suggested-events/:volunteerId

// Get candidate volunteers for an event (admin feature) - mount this at root level
// This will be handled in server.js as /events/:eventId/candidates

export default router;