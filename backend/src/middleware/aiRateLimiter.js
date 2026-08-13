const rateLimit = require('express-rate-limit');

// Per-user limiter for AI endpoints — keyed by authenticated user, not IP,
// since IP-based limiting is meaningless behind shared/university networks.
// Must be mounted AFTER `authenticate` so req.user is populated.
const createAiLimiter = ({ windowMs, max, actionLabel }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true, // adds RateLimit-* headers
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip, // fallback to IP only if somehow unauthenticated
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: `Too many ${actionLabel} requests. Please wait a few minutes and try again.`,
      });
    },
  });

const textActionLimiter = createAiLimiter({
  windowMs: Number(process.env.AI_TEXT_RATE_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: Number(process.env.AI_TEXT_RATE_MAX) || 20,
  actionLabel: 'AI text-action',
});

const imageActionLimiter = createAiLimiter({
  windowMs: Number(process.env.AI_IMAGE_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.AI_IMAGE_RATE_MAX) || 20,
  actionLabel: 'AI image-action',
});

module.exports = { textActionLimiter, imageActionLimiter };