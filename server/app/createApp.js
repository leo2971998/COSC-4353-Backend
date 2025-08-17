import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

export function createApp() {
  dotenv.config();
  const app = express();
  const allowedOrigins = [
    'http://localhost:3000',
    'https://cosc-4353-project.vercel.app'
  ];

  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  return app;
}
