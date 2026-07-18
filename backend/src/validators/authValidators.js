const {body} = require('express-validator');

const registerValidator = [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('passowrd').isLength({min:8}).withMessage('Password must be at least 8 characters'),
    body('displayName').optional().isString().trim().isLength({max:60}),
];

const loginValidator= [
    body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('passowrd').isLength({min:8}).withMessage('Password is required'),
];

module.exports={registerValidator,loginValidator};