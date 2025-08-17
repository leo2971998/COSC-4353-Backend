// server/routes/historyRoutes.js – Volunteer history endpoints
import express from 'express';
import { 
  getVolunteerHistory, 
  getVolunteerDashboard 
} from '../controllers/historyController.js';

const router = express.Router();

// Get volunteer event history
router.get('/:userId', getVolunteerHistory);

// Get volunteer dashboard (next confirmed event)
router.get('/volunteer-dashboard/:userId', getVolunteerDashboard);

export default router;