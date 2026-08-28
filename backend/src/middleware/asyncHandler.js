// Wraps an async route handler so unhandled promise rejections are passed to
// Express's error handler instead of crashing the process or hanging the request.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
