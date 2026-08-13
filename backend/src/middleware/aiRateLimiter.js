const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// Per-user limiter for AI endpoints — keyed by authenticated user, not IP,
// since IP-based limiting is meaningless behind shared/university networks.
// Must be mounted AFTER `authenticate` so req.user is populated.
const createAiLimiter = ({ windowMs, max, actionLabel }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Prefer the authenticated user's id. Fall back to a normalized IP key
    // only if somehow unauthenticated — ipKeyGenerator() correctly collapses
    // equivalent IPv6 addresses so the fallback can't be trivially bypassed.
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: `Too many ${actionLabel} requests. Please wait a few minutes and try again.`,
      });
    },
  });

const textActionLimiter = createAiLimiter({
  windowMs: Number(process.env.AI_TEXT_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.AI_TEXT_RATE_MAX) || 20,
  actionLabel: 'AI text-action',
});

const imageActionLimiter = createAiLimiter({
  windowMs: Number(process.env.AI_IMAGE_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.AI_IMAGE_RATE_MAX) || 20,
  actionLabel: 'AI image-action',
});

module.exports = { textActionLimiter, imageActionLimiter };