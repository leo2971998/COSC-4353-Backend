import { Router } from 'express';
import { getHistory } from '../controllers/historyController.js';

const router = Router();
router.get('/history/:userId', getHistory);

export default router;
