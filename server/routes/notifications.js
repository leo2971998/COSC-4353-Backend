import { Router } from 'express';
import { listNotifications } from '../controllers/notificationsController.js';

const router = Router();
router.get('/notifications', listNotifications);

export default router;
