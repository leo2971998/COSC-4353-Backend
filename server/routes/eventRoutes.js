// server/routes/eventRoutes.js – CRUD for events and skills
import express from 'express';
import { 
  getAllEvents, 
  createEvent, 
  updateEvent, 
  deleteEvent, 
  getEventById, 
  getEventsByUser,
  createEventRequest,
  createBulkEventRequests
} from '../controllers/eventController.js';

const router = express.Router();

// Event CRUD operations
router.get('/', getAllEvents);
router.post('/', createEvent);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);
router.get('/by-id/:eventId', getEventById);
router.get('/:userId', getEventsByUser);

// Event request creation (mounted under /events)
router.post('/:eventId/requests', createEventRequest);
router.post('/:eventId/requests/bulk', createBulkEventRequests);

export default router;