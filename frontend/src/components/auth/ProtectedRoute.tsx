import { ReactNode } from "react";
import { Navigate } from "react-router-dom";

// Route-level guard: redirects before the page renders (no flash-of-content), instead of the
// per-page useEffect+navigate pattern used elsewhere in this app. Still reads the same
// localStorage UI hints as everything else (see lib/session.ts's persistUiHints) — these are
// non-functional sentinels, not credentials, so this component is UX polish (skip the flash,
// centralize the redirect), not the real security boundary. The backend now enforces
// authorization on every route this guards; this only makes the client experience match that.
type Props = { role: "admin" | "seller"; children: ReactNode };

export function ProtectedRoute({ role, children }: Props) {
  const hasSession = localStorage.getItem("token") === "session";
  if (!hasSession) return <Navigate to="/auth" replace />;

  const flag = role === "admin" ? "isAdmin" : "isSeller";
  if (localStorage.getItem(flag) !== "true") return <Navigate to="/" replace />;

  return <>{children}</>;
}
