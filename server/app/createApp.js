// server/app/createApp.js - Alternate lightweight API factory used in tests
import express from 'express';
import cors from 'cors';
import { db, USE_DB } from '../db.js';

export const createApp = (options = {}) => {
  const app = express();
  
  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  if (options.enableCors !== false) {
    app.use(cors({ origin: options.corsOrigin || ["http://localhost:5173"] }));
  }
  
  if (options.enableLogging !== false) {
    app.use((req, _res, next) => {
      console.log(`${req.method} ${req.url}`);
      next();
    });
  }

  return app;
};

export const createTestApp = () => {
  return createApp({
    enableCors: false,
    enableLogging: false
  });
};