import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

export function createApp() {
  dotenv.config();
  const app = express();
  const allowedOrigins = [
    'https://cosc-4353-project.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ];

  // Add environment variable if it exists
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  app.use(cors({ 
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  return app;
}
