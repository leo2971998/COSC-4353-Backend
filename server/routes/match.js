import { Router } from 'express';
import { matchVolunteer } from '../controllers/matchController.js';

const router = Router();
router.get('/:id', matchVolunteer);

export default router;
