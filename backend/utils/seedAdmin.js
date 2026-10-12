import bcrypt from "bcryptjs"
import { Admin } from "../models/Admin.js"

// Provisions/keeps the single admin account in sync with .env on every boot.
// The .env ADMIN_EMAIL/ADMIN_PASSWORD is treated as the source of truth: if no
// admin exists it is created; if one exists its email + password are re-synced
// to whatever .env currently holds. This intentionally overwrites a password
// that drifted out of sync with .env (an earlier boot had seeded a different
// password, which then made login with the .env credentials fail).
//
// NOTE: because .env is authoritative, if a change-password flow is added later
// it must also update .env (or this sync should be gated behind a flag), or the
// changed password would be reset back to the .env value on the next restart.
export async function seedAdminFromEnv() {
    const email = process.env.ADMIN_EMAIL
    const password = process.env.ADMIN_PASSWORD
    if (!email || !password) {
        console.warn("[seedAdmin] ADMIN_EMAIL/ADMIN_PASSWORD not set in .env — skipping admin sync")
        return
    }

    const normalizedEmail = email.toLowerCase().trim()
    const hashed = await bcrypt.hash(password, 10)

    // `$ne: "very-admin"` rather than `role: "admin"` so admin documents created
    // before the role field existed (they have no `role` at all) still match.
    const OWNER = { role: { $ne: "very-admin" } }
    const existing = await Admin.findOne(OWNER).sort({ createdAt: 1 })

    if (!existing) {
        await Admin.create({ email: normalizedEmail, password: hashed, role: "admin" })
        console.log(`[seedAdmin] Created initial admin account: ${normalizedEmail}`)
        return
    }

    // Re-sync the (single) admin to the current .env credentials. bcrypt.compare
    // lets us skip the write when the password is already the .env one, so we
    // don't churn the document on every restart.
    const samePassword = await bcrypt.compare(password, existing.password)
    if (existing.email === normalizedEmail && samePassword && existing.role === "admin") {
        return
    }

    existing.email = normalizedEmail
    existing.password = hashed
    existing.role = "admin"
    await existing.save()

    // If there were somehow multiple owner docs, collapse to the one we just
    // synced so a stale second account can't shadow the .env credentials. Scoped
    // to owner accounts — the legacy very-admin below is a separate, intentional row.
    await Admin.deleteMany({ ...OWNER, _id: { $ne: existing._id } })

    console.log(`[seedAdmin] Synced admin account to .env credentials: ${normalizedEmail}`)
}

// LEGACY second account, kept so an existing VERY_ADMIN_* login is not
// invalidated. Its old panel is gone — it now signs in at /admin/login and gets
// the same dashboard as the owner. Same .env-is-authoritative contract as above.
// Drop the VERY_ADMIN_* vars from .env (and the call in server.js) to retire it.
export async function seedVeryAdminFromEnv() {
    const email = process.env.VERY_ADMIN_EMAIL
    const password = process.env.VERY_ADMIN_PASSWORD
    if (!email || !password) {
        console.warn("[seedAdmin] VERY_ADMIN_EMAIL/VERY_ADMIN_PASSWORD not set in .env — skipping very-admin sync")
        return
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await Admin.findOne({ role: "very-admin" })

    if (!existing) {
        await Admin.create({
            email: normalizedEmail,
            password: await bcrypt.hash(password, 10),
            role: "very-admin",
        })
        console.log(`[seedAdmin] Created very-admin account: ${normalizedEmail}`)
        return
    }

    const samePassword = await bcrypt.compare(password, existing.password)
    if (existing.email === normalizedEmail && samePassword) return

    existing.email = normalizedEmail
    existing.password = await bcrypt.hash(password, 10)
    await existing.save()
    await Admin.deleteMany({ role: "very-admin", _id: { $ne: existing._id } })

    console.log(`[seedAdmin] Synced very-admin account to .env credentials: ${normalizedEmail}`)
}
