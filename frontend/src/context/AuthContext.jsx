"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  confirmUserEmailChange,
  fetchAdminMe,
  fetchUserMe,
  googleSignInAccount,
  loginAdmin,
  loginUserAccount,
  registerUserAccount,
  requestPasswordReset,
  requestUserEmailChange,
  resendUserCode,
  resetUserPassword,
  updateUserProfile,
  verifyUserCode,
} from "@/lib/api";

const AuthContext = createContext(null);
const TOKEN_KEY = "techstore-admin-token";
const USER_TOKEN_KEY = "techstore-user-token";

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Customer account state — separate token/identity from the admin's, both
  // backed by the backend User model (/api/user/*).
  const [user, setUser] = useState(null);
  const [userToken, setUserToken] = useState(null);
  const [userLoading, setUserLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    fetchAdminMe(stored)
      .then((data) => {
        setToken(stored);
        setAdmin(data);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(USER_TOKEN_KEY);
    if (!stored) {
      setUserLoading(false);
      return;
    }
    fetchUserMe(stored)
      .then((data) => {
        setUserToken(stored);
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem(USER_TOKEN_KEY);
      })
      .finally(() => setUserLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { token: newToken, data } = await loginAdmin(email, password);
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setAdmin(data);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAdmin(null);
  }, []);

  // Signup and signin are both two-step now. These only prove the password and
  // trigger the emailed 4-digit code — they resolve to
  // { requiresVerification, email, devCode? } and deliberately establish no
  // session. verifyCode below is the only thing that stores a token.
  const registerUser = useCallback(
    ({ name, email, password }) => registerUserAccount({ name, email, password }),
    [],
  );

  const loginUser = useCallback(
    (email, password) => loginUserAccount(email, password),
    [],
  );

  // Step 2 of both flows: a correct code is what actually signs you in.
  const verifyCode = useCallback(async (email, code) => {
    const { token: newToken, data } = await verifyUserCode(email, code);
    localStorage.setItem(USER_TOKEN_KEY, newToken);
    setUserToken(newToken);
    setUser(data);
    return data;
  }, []);

  const resendCode = useCallback((email) => resendUserCode(email), []);

  // Google sign-in/sign-up is a single step: the backend verifies Google's ID
  // token and hands back a session straight away. `created` is true for a
  // brand-new account (the register screen then shows its first-order code).
  const googleSignIn = useCallback(async (credential) => {
    const { token: newToken, data, created } = await googleSignInAccount(credential);
    localStorage.setItem(USER_TOKEN_KEY, newToken);
    setUserToken(newToken);
    setUser(data);
    return { account: data, created };
  }, []);

  // ── Password reset ──
  // Step 1 establishes no session and tells you nothing about whether the
  // address exists — the backend answers the same way either way.
  const forgotPassword = useCallback((email) => requestPasswordReset(email), []);

  // Step 2 signs the customer straight in: they have just proven the address
  // (via the code) and chosen a new password, so there is nothing left to ask.
  const resetPassword = useCallback(async (email, code, password) => {
    const { token: newToken, data } = await resetUserPassword(email, code, password);
    localStorage.setItem(USER_TOKEN_KEY, newToken);
    setUserToken(newToken);
    setUser(data);
    return data;
  }, []);

  // ── Account settings ──
  // Results are merged into the existing user rather than replacing it: /me
  // returns the whole document while these return the backend's publicUser(),
  // and the rest of the app reads fields from both shapes.
  const updateProfile = useCallback(
    async (changes) => {
      const data = await updateUserProfile(changes, userToken);
      setUser((prev) => ({ ...prev, ...data }));
      return data;
    },
    [userToken],
  );

  // Only mails the code — the account keeps its current email until
  // confirmEmailChange below succeeds.
  const requestEmailChange = useCallback(
    (email) => requestUserEmailChange(email, userToken),
    [userToken],
  );

  const confirmEmailChange = useCallback(
    async (code) => {
      const { token: newToken, data } = await confirmUserEmailChange(code, userToken);
      localStorage.setItem(USER_TOKEN_KEY, newToken);
      setUserToken(newToken);
      setUser((prev) => ({ ...prev, ...data }));
      return data;
    },
    [userToken],
  );

  const logoutUser = useCallback(() => {
    localStorage.removeItem(USER_TOKEN_KEY);
    setUserToken(null);
    setUser(null);
  }, []);

  // Live check against MongoDB: does the account behind the stored token still
  // exist? Returns the fresh user document, or null (clearing stale state) —
  // used by checkout to decide between placing the order and redirecting to
  // /register.
  const verifyUserInDb = useCallback(async () => {
    const stored = localStorage.getItem(USER_TOKEN_KEY);
    if (!stored) return null;
    try {
      const data = await fetchUserMe(stored);
      setUserToken(stored);
      setUser(data);
      return data;
    } catch {
      localStorage.removeItem(USER_TOKEN_KEY);
      setUserToken(null);
      setUser(null);
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        admin,
        token,
        isAdmin: !!admin,
        loading,
        login,
        logout,
        user,
        userToken,
        isUser: !!user,
        userLoading,
        registerUser,
        loginUser,
        verifyCode,
        resendCode,
        googleSignIn,
        forgotPassword,
        resetPassword,
        updateProfile,
        requestEmailChange,
        confirmEmailChange,
        logoutUser,
        verifyUserInDb,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
