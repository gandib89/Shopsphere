// Compatibility exports; all four listing draft routes share the subject budget.
import { consumeDraftLimit, createDraftLimit } from "./assistantDraftLimits.js";
export const consumeListingDraftLimit = (redis, options) => consumeDraftLimit(redis, options);
export const enforceListingDraftLimit = (options = {}) => createDraftLimit(options);
