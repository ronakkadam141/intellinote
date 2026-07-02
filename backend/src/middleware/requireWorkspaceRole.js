const WorkspaceMember = require('../models/WorkspaceMember');

/*
    Role hierarchy — order determines permission level.
    A role can perform any action its level or below requires.
*/
const ROLE_HIERARCHY = ['viewer', 'editor', 'owner'];

/*
    Factory function — returns a middleware that enforces a minimum role requirement.

    Usage:
    requireWorkspaceRole('editor')  — allows editor and owner
    requireWorkspaceRole('owner')   — allows owner only

    Relies on req.workspaceMember being set by requireWorkspaceAccess.
    Always use AFTER requireWorkspaceAccess in the middleware chain.
*/
const requireWorkspaceRole = (minimumRole) => {
  // Validate at startup — catches typos during development immediately
  if (!ROLE_HIERARCHY.includes(minimumRole)) {
    throw new Error(
      `requireWorkspaceRole: invalid role "${minimumRole}". Must be one of: ${ROLE_HIERARCHY.join(', ')}`
    );
  }

  return async (req, res, next) => {
    // requireWorkspaceAccess must run first to populate this
    if (!req.workspaceMember) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'MIDDLEWARE_ORDER_ERROR',
          message: 'requireWorkspaceRole must be used after requireWorkspaceAccess.',
        },
      });
    }

    const userRoleIndex = ROLE_HIERARCHY.indexOf(req.workspaceMember.role);
    const requiredRoleIndex = ROLE_HIERARCHY.indexOf(minimumRole);

    if (userRoleIndex < requiredRoleIndex) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `This action requires ${minimumRole} access or higher.`,
        },
      });
    }

    return next();
  };
};

module.exports = { requireWorkspaceRole, ROLE_HIERARCHY };