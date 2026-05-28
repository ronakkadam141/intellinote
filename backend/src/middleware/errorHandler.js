/*
    Centralized error handling middleware.
    Must be registered LAST in Express — after all routes.
    Usage in controllers: catch (err) { return next(err); }
*/
const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid ID format.' },
    });
  }

  // MongoDB duplicate key
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE_KEY', message: 'A record with this value already exists.' },
    });
  }

  // Default — don't leak stack traces to clients
  return res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
};

module.exports = { errorHandler };