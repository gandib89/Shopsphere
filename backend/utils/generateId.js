import { randomBytes } from "crypto";

// 24 hex chars, same shape as the MongoDB ObjectIds this app used to generate —
// keeps every id column's VarChar(24) valid for both migrated and new rows.
export const generateId = () => randomBytes(12).toString("hex");
