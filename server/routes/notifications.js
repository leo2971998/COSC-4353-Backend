// server/routes/notifications.js – Generic notification CRUD
import express from 'express';
import { 
  getAllNotifications, 
  getNotificationsByUser, 
  createNotification,
  getVolunteerRequestNotifications 
} from '../controllers/notificationsController.js';

const router = express.Router();

// General notifications
router.get('/', getAllNotifications);
router.get('/:userId', getNotificationsByUser);
router.post('/', createNotification);

// Volunteer request notifications
router.get('/vr-notifications/:volunteerId', getVolunteerRequestNotifications);

export default router;