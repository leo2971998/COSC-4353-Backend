// server/routes/vDashRoutes.js – Volunteer dashboard features (enroll/withdraw events, calendar data, etc.)
import express from 'express';
import { 
  enrollInEvent, 
  getEnrolledEvents, 
  getBrowseEvents, 
  getCalendarData 
} from '../controllers/vDashController.js';

const router = express.Router();

// Enroll in an event
router.post('/browse-enroll/:userId/:eventId', enrollInEvent);

// Get enrolled events for a volunteer
router.get('/enrolled-events/:userId', getEnrolledEvents);

// Get available events to browse for a volunteer
router.get('/browse-events/:userId', getBrowseEvents);

// Get calendar data for a volunteer
router.get('/calendar/:userId', getCalendarData);

export default router;