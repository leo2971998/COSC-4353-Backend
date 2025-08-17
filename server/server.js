import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

import db from './db.js';
import eventRoutes from './routes/eventRoutes.js';
import matchRoutes from './routes/match.js';
import notificationRoutes from './routes/notifications.js';
import historyRoutes from './routes/historyRoutes.js';
import vDashRoutes from './routes/vDashRoutes.js';

dotenv.config();

const app = express();
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://cosc-4353-project.vercel.app'
];

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000');
}

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Authentication endpoints
app.post('/register', (req, res) => {
  res.status(201).json({ message: 'registered' });
});
app.post('/login', (req, res) => {
  res.json({ token: 'fake-token' });
});
app.get('/profile', (req, res) => {
  res.json({ user: null });
});

// Mount routes
app.use(eventRoutes);
app.use('/match', matchRoutes);
app.use(notificationRoutes);
app.use(historyRoutes);
app.use('/dashboard', vDashRoutes);

export default app;
