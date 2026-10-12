/**
 * Operational error with an HTTP status code. Thrown from controllers/services
 * and caught by the centralized errorHandler (middleware/errorHandler.js),
 * which already reads `err.statusCode`. Using this keeps every new payment
 * path on one error channel instead of ad-hoc res.status(...).json(...).
 */
export default class ApiError extends Error {
    constructor(statusCode, message, details = null) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        if (details) this.details = details;
        Error.captureStackTrace?.(this, ApiError);
    }

    static badRequest(message, details) {
        return new ApiError(400, message, details);
    }

    static unauthorized(message = "Not authorized") {
        return new ApiError(401, message);
    }

    static forbidden(message = "Forbidden") {
        return new ApiError(403, message);
    }

    static notFound(message = "Not found") {
        return new ApiError(404, message);
    }

    static conflict(message) {
        return new ApiError(409, message);
    }

    static serviceUnavailable(message = "Payment provider unavailable") {
        return new ApiError(503, message);
    }
}
