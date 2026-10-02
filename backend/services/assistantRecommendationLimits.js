// Compatibility exports; recommendations consume the shared subject draft budget.
export {
  DRAFT_LIMITS_PER_MINUTE as RECOMMENDATION_LIMITS_PER_MINUTE,
  DRAFT_LIMITS_PER_DAY as RECOMMENDATION_LIMITS_PER_DAY,
  createDraftLimit as createRecommendationLimit,
} from "./assistantDraftLimits.js";
