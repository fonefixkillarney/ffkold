export const REFRESH_COOKIE = "refreshToken";

const isProd = process.env.NODE_ENV === "production";

export const setRefreshCookie = (res, token) => {
    res.cookie(REFRESH_COOKIE, token, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/api/auth",
    });
};

export const clearRefreshCookie = (res) => {
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
};
