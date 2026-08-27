import jwt from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from "crypto";

const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const signAccessToken = ({ id, role }) =>
  jwt.sign({ sub: id, role, jti: randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

export const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

// Opaque, not a JWT: refresh tokens are only ever looked up by hash, never decoded.
export const generateRefreshToken = () => randomBytes(32).toString("base64url");

export const hashRefreshToken = (token) => createHash("sha256").update(token).digest("hex");
