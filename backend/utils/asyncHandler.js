/**
 * Wraps an async Express handler so any rejected promise is forwarded to
 * next() (and therefore to the centralized errorHandler) instead of hanging
 * the request. Lets new payment controllers throw ApiError freely without a
 * try/catch in every function.
 */
const asyncHandler = (handler) => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
