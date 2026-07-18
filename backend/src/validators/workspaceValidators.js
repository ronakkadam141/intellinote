const {body} = require('express-validator');

const createWorkspaceValidator = [
    body('name').trim().notEmpty().withMessage('Workspace name is required').isLength({max:100}),
    body('description').optional().isString().trim().isLength({max:500}),
];

const updateWorkspaceValidator=[
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({max:100}),
    body('description').optional().isString().trim().isLength({max:500}),
];

module.exports = {createWorkspaceValidator,updateWorkspaceValidator};
