import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export const hashPassword = (plainPassword) => bcrypt.hash(plainPassword, SALT_ROUNDS);

/**
 * Password check that tolerates a missing hash.
 *
 * Since Google sign-up landed, an admin can legitimately have no
 * `passwordHash` at all. bcrypt throws "Illegal arguments" on an undefined
 * hash, which would turn a wrong-flow login attempt into a 500 - so the guard
 * lives here rather than at each call site (admin login, agent login, admin
 * and super-admin change-password, seeds).
 *
 * A stored password that does not exist can never match a submitted one, so
 * `false` is the correct answer rather than an error.
 */
export const comparePassword = async (plainPassword, passwordHash) => {
    if (!plainPassword || !passwordHash) return false;
    return bcrypt.compare(plainPassword, passwordHash);
};
