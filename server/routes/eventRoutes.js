import { Router } from 'express';
import { listEvents, createEvent } from '../controllers/eventController.js';

const router = Router();
router.get('/events', listEvents);
router.post('/events', createEvent);

export default router;
