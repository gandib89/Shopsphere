import express from "express";

import { authenticate } from "../middlewares/authMiddleware.js";
import { beginConnection, getConnectionCatalog, listConnections, revokeConnection } from "../controller/aiConnections.js";

const router = express.Router();
router.use(authenticate);
router.get("/catalog", getConnectionCatalog);
router.get("/", listConnections);
router.post("/", (req, res) => beginConnection(req, res));
router.delete("/:clientId", (req, res) => revokeConnection(req, res));

export default router;
