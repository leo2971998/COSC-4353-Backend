import { Router } from 'express';
import { enrollEvent } from '../controllers/vDashController.js';

const router = Router();
router.post('/enroll', enrollEvent);

export default router;
