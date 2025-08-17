import express from "express";

const router = express.Router();

router.get("/time", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ serverIso: new Date().toISOString() });
});

export default router;
