const jwt = require('jsonwebtoken');

/*
    Verifies JWT and attaches req.user = { id, email } to the request.
    All protected routes must run this middleware first.
*/

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Authentication token required.' },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach structured user object — extendable without breaking changes
    req.user = {
      id: decoded.id,
      email: decoded.email,
    };

    return next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';

    return res.status(401).json({
      success: false,
      error: {
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: isExpired
          ? 'Session expired. Please log in again.'
          : 'Invalid authentication token.',
      },
    });
  }
};

module.exports = { authenticate };