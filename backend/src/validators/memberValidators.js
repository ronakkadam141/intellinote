const {body} = require('express-validator');

const inviteMemberValidator = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('role')
        .isIn(['viewer','editor','owner'])
        .withMessage("Role must be 'editor' or 'viewer' — owners are promoted, not invited."),
];

const updateMemberRoleValidator = [
    body('role').isIn(['viewer','editor','owner']).withMessage('Invalid role.')
];

module.exports = {inviteMemberValidator,updateMemberRoleValidator}