const express = require('express');
const router = express.Router({ mergeParams: true });

const { authenticate } = require('../middleware/auth');
const { requireWorkspaceAccess } = require('../middleware/requireWorkspaceAccess');
const { getMyMembership } = require('../controllers/workspaceMemberController');

router.get('/me', authenticate, requireWorkspaceAccess, getMyMembership);

module.exports = router;