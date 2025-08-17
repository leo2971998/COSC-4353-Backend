// server.js – entry point
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import "./config/db.js";

import eventsRoutes from "./routes/events.js";
import matchRoutes from "./routes/match.js";
import notificationsRoutes from "./routes/notifications.js";
import historyRoutes from "./routes/history.js";
import dashboardRoutes from "./routes/dashboard.js";
import suggestedEventsRoutes from "./routes/suggestedEvents.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import requestsRoutes from "./routes/requests.js";
import reportsRoutes from "./routes/reports.js";
import miscRoutes from "./routes/misc.js";

dotenv.config();

const app = express();

const corsOptions = { origin: ["http://localhost:5173"] };
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`${req.method}  ${req.url}`); // eslint-disable-line no-console
  next();
});

app.use(eventsRoutes);
app.use(matchRoutes);
app.use(notificationsRoutes);
app.use(historyRoutes);
app.use(dashboardRoutes);
app.use(suggestedEventsRoutes);
app.use(authRoutes);
app.use(adminRoutes);
app.use(requestsRoutes);
app.use(reportsRoutes);
app.use(miscRoutes);

export default app;
