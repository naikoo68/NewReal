import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authService } from "../services";
import { setToken, clearToken, getToken } from "../lib/api";

const AuthContext = createContext();

// Real auth backed by the API. The JWT is stored via the api layer and the
// user profile is cached in localStorage for instant first paint, then
// revalidated against /auth/me on load.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("mpm-user");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(!!getToken());

  const persist = useCallback((u) => {
    if (u) {
      // Keep `avatar` as the raw value (photo URL / data-URI, or empty). The
      // <Avatar> component decides whether to show the picture or initials.
      localStorage.setItem("mpm-user", JSON.stringify(u));
      setUser(u);
      return u;
    }
    localStorage.removeItem("mpm-user");
    setUser(null);
    return null;
  }, []);

  // Revalidate the session on first load if a token exists.
  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    authService
      .me()
      .then((res) => active && persist(res.user))
      .catch((err) => {
        // Only sign out on a REAL auth failure (expired/invalid token). On a
        // transient error — network blip or a free-tier server still waking up
        // (the api layer surfaces these without a 401/403) — keep the cached
        // session so refreshing a page doesn't kick the user out to login.
        if (active && (err?.status === 401 || err?.status === 403)) {
          clearToken();
          persist(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [persist]);

  const login = async (email, password) => {
    const { user: u, token } = await authService.login(email, password);
    setToken(token);
    return persist(u);
  };

  // Sign in directly from a token + profile (e.g. after a paid registration
  // that returns a session instead of requiring an OTP).
  const applySession = (token, u) => {
    setToken(token);
    return persist(u);
  };

  // Registration now returns { needsVerification, email, emailSent, devOtp? }
  // and does NOT sign the user in until the OTP is verified.
  const register = async (name, email, password, role, extra) => {
    return authService.register(name, email, password, role, extra);
  };

  // Confirm the OTP → signs the user in (stores JWT + profile).
  const verifyOtp = async (email, otp) => {
    const { user: u, token } = await authService.verifyOtp(email, otp);
    setToken(token);
    return persist(u);
  };

  const resendOtp = (email) => authService.resendOtp(email);

  // Re-fetch the current profile (e.g. after an upgrade extends validity).
  const refreshUser = useCallback(async () => {
    const res = await authService.me();
    return persist(res.user);
  }, [persist]);

  const loginWithGoogle = async (profile) => {
    const { user: u, token } = await authService.google(profile);
    setToken(token);
    return persist(u);
  };

  const logout = () => {
    clearToken();
    persist(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, verifyOtp, resendOtp, loginWithGoogle, logout, applySession, refreshUser, isAuthenticated: !!user }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
