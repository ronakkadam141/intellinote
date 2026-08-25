const {body} = require('express-validator');

const registerValidator = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isLength({min:8}).withMessage('Password must be at least 8 characters'),
    body('displayName').optional().isString().trim().isLength({max:60}),
];

const loginValidator= [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('password').isLength({min:8}).withMessage('Password is required'),
];

const updateDisplayNameValidator = [
    body('displayName')
        .trim()
        .notEmpty().withMessage('Display name cannot be empty.')
        .isLength({ max: 60 }).withMessage('Display name must be 60 characters or fewer.'),
];

module.exports={registerValidator,loginValidator,updateDisplayNameValidator};