import express from "express";
import { prisma } from "../database/prismaClient.js";

const router = express.Router();

// Liveness — process is up, no dependency checks. What a container orchestrator restarts on.
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness — can this instance actually serve traffic right now (DB reachable)?
// What a load balancer/compose healthcheck should poll before routing to this container.
router.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok" });
  } catch (error) {
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
