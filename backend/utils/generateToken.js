import jwt from "jsonwebtoken";

export const generateAccessToken = (id, role) =>
    jwt.sign({ id, role }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    });

export const generateRefreshToken = (id, role, tokenVersion) =>
    jwt.sign({ id, role, tokenVersion }, process.env.JWT_REFRESH_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
    });

export const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);

export const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);
