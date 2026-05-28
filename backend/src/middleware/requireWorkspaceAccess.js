const WorkspaceMember = require('../models/WorkspaceMember');

/*
    Verifies that the authenticated user is a member of the requested workspace.
    Allows any role: owner, editor, viewer.
    Use for: read operations, dashboard views, document listing.
    Attaches req.workspaceMember = { id, userId, workspaceId, role }
    so downstream middleware and controllers don't re-query membership.
*/

const requireWorkspaceAccess = async (req, res, next) => {
  const { workspaceId } = req.params;

  if (!workspaceId) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_WORKSPACE_ID', message: 'Workspace ID is required.' },
    });
  }

  try {
    const membership = await WorkspaceMember.findOne({
      workspaceId,
      userId: req.user.id,
    }).lean();

    if (!membership) {
      // Deliberately vague — don't reveal whether the workspace exists
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this workspace.',
        },
      });
    }

    // Attach for downstream use — controllers never need to re-query this
    req.workspaceMember = {
      id: membership._id,
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };

    return next();
  } catch (err) {
    return next(err); // Passes to centralized error handler
  }
};

module.exports = { requireWorkspaceAccess };