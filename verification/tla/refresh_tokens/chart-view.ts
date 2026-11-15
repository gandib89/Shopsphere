// View for /statechart: staying signed in with a refresh-token cookie. Use with flow.cfg.
type V = { [k: string]: any };

const live = (v: V) =>
  Object.keys(v.used).filter((t) => !v.used[t] && !v.revoked[t]).length;

export const title = "Staying signed in: refresh-token rotation";
export const state = (v: V) => {
  const n = live(v);
  const copied = (v.holds.other as unknown[]).length > 0;
  if (v.ended) return n > 0 ? "Signed out, but a token still works" : "Signed out";
  if (n > 1) return "Two working tokens";
  const where = copied ? "token also in another tab or thief" : "token only in your browser";
  return n === 1 ? `Signed in, ${where}` : "Mid-refresh";
};

export const step = (action: string, from: V, to: V) => {
  switch (action) {
    case "Copy": return "another tab or a thief gets the cookie";
    case "Read": return to.ended && !from.ended ? "a used token is replayed" : "a refresh request arrives";
    case "MarkUsed": return "the server marks the token used";
    case "Issue": return "the server issues a new token";
    case "Logout": return "you log out";
    default: return null;
  }
};
