import axios from "axios";

const API_BASE = import.meta.env.VITE_BACKEND_URL;
const AUTH_PATHS = ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh"];

// The real bearer access token lives ONLY here (module memory) — never localStorage,
// per the backend's token model. It's attached to every axios request by the
// interceptor below, so none of the ~40 pages that call `axios` directly need to
// know it exists.
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

axios.defaults.withCredentials = true; // send the httpOnly refresh cookie

export type SessionUser = { id: string; email: string; role: string; admin: boolean; seller: boolean; sellerVerified: boolean };

// ponytail: dozens of existing pages gate nav/UI purely on `localStorage.getItem('token')`
// being truthy, and rewriting all of them to a shared auth context is a much bigger
// change than "wire the new backend up". So `token` here is a non-functional sentinel,
// not a credential — it can't authenticate anything, it only keeps that UI check working.
// Upgrade path: replace those reads with a `useSession()` hook backed by this module.
const persistUiHints = (user: SessionUser) => {
  localStorage.setItem("token", "session");
  localStorage.setItem("isAdmin", String(user.admin));
  localStorage.setItem("isSeller", String(user.seller));
  localStorage.setItem("userId", user.id);
};

const clearUiHints = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("isAdmin");
  localStorage.removeItem("isSeller");
  localStorage.removeItem("userId");
};

const setSession = (token: string, user: SessionUser) => {
  accessToken = token;
  persistUiHints(user);
};

export const clearSession = () => {
  accessToken = null;
  clearUiHints();
};

export const getAccessToken = () => accessToken;

export const login = async (email: string, password: string) => {
  const { data } = await axios.post(`${API_BASE}/api/v1/auth/login`, { email, password });
  setSession(data.accessToken, data.user);
  return data.user as SessionUser;
};

export const register = async (payload: Record<string, unknown>) => {
  const { data } = await axios.post(`${API_BASE}/api/v1/auth/register`, payload);
  setSession(data.accessToken, data.user);
  return data.user as SessionUser;
};

export const googleLogin = async (idToken: string) => {
  const { data } = await axios.post(`${API_BASE}/api/v1/auth/google-signin`, { token: idToken });
  setSession(data.accessToken, data.user);
  return data.user as SessionUser;
};

export const logout = async () => {
  try {
    await axios.post(`${API_BASE}/api/v1/auth/logout`);
  } catch {
    // Best-effort: clear the local session either way.
  }
  clearSession();
};

// Restores the in-memory access token from the httpOnly refresh cookie after a hard
// reload (access tokens live in memory only, so they don't survive one). Also the
// natural place reuse-detection surfaces: a stolen/replayed cookie fails here and we
// fall back to logged-out instead of retrying forever.
export const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/api/v1/auth/refresh`)
      .then(({ data }) => {
        setSession(data.accessToken, data.user);
        return data.accessToken as string;
      })
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

axios.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthRoute = AUTH_PATHS.some((path) => original?.url?.includes(path));
    if (error.response?.status === 401 && original && !original._retriedAfterRefresh && !isAuthRoute) {
      original._retriedAfterRefresh = true;
      const token = await refreshSession();
      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return axios(original);
      }
    }
    return Promise.reject(error);
  }
);
