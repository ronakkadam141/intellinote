/*
    Centralized error handling middleware.
    Must be registered LAST in Express — after all routes.
    Usage in controllers: catch (err) { return next(err); }
*/
const errorHandler = (err, req, res, next) => {
  const context = `${req.method} ${req.path}${req.user?.id ? ` (user ${req.user.id})` : ''}`;

  // Mongoose validation error — expected client-input mistake, not a bug.

  
  if (err.name === 'ValidationError') {
    console.warn(`[VALIDATION] ${context}:`, err.message);
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }

  // Mongoose bad ObjectId — same category, expected.
  if (err.name === 'CastError') {
    console.warn(`[BAD_ID] ${context}:`, err.message);
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid ID format.' },
    });
  }

  // MongoDB duplicate key — expected, user-caused.
  if (err.code === 11000) {
    console.warn(`[DUPLICATE] ${context}:`, err.message);
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE_KEY', message: 'A record with this value already exists.' },
    });
  }

  // Everything else is unexpected — this is the path that was previously
  // silent on the details that actually matter for debugging. Logs the
  // full stack (not just err.message), the error's own name/code if it
  // has one (many controllers already throw typed errors like AI_TIMEOUT
  // or FOLDER_NOT_FOUND — if one reaches here unhandled, that code is the
  // fastest way to see which code path was missed), and request context.

  if (err.statusCode) {
    const isClientError = err.statusCode < 500;
    (isClientError ? console.warn : console.error)(
      `[${err.code || 'HANDLED'}] ${context}:`, err.message
    );
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  }
  
  console.error(
    `[UNHANDLED ERROR] ${context}\n` +
    `  name: ${err.name || 'Error'}${err.code ? `, code: ${err.code}` : ''}\n` +
    `  message: ${err.message}\n` +
    `  stack: ${err.stack}`
  );

  return res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
};

module.exports = { errorHandler };