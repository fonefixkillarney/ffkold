import jwt from "jsonwebtoken"

export function protect(req, res, next) {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null
    if (!token) return res.status(401).json({ success: false, message: "Not authenticated" })

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET)
        next()
    } catch {
        res.status(401).json({ success: false, message: "Invalid or expired token" })
    }
}

// Any admin-family role. The legacy "very-admin" is still accepted so accounts
// created before that separate panel was folded into /admin keep working — the
// whole admin surface (orders, prices, the approval queue, deletes) is behind
// this one gate now.
export function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin" && req.user?.role !== "very-admin") {
        return res.status(403).json({ success: false, message: "Admin access required" })
    }
    next()
}

// Same token read as `protect`, but never rejects: a request with no token (or a
// bad one) simply arrives with req.user undefined. For endpoints that are public
// but show MORE to an admin — the single-product route, which must 404 an
// unapproved product for shoppers while still letting the admin preview it.
export function attachUser(req, _res, next) {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null
    if (token) {
        try {
            req.user = jwt.verify(token, process.env.JWT_SECRET)
        } catch {
            // Anonymous — an expired admin token must not 401 a public read.
        }
    }
    next()
}
