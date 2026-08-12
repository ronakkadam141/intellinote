const {body}= require('express-validator');

const {VALID_ACTIONS,VALID_IMAGE_ACTIONS}= require('../services/aiService');

const textActionValidators = [
    body('text').isString().trim().notEmpty().withMessage('text is required').isLength({max:8000}),
    body('action').isIn(VALID_ACTIONS).withMessage(`action must be one of: ${VALID_ACTIONS.join(',')}`),
    body('context').optional().isString().trim().isLength({max:2000}),
];

const imageActionValidators = [
    body('imageUrl').isURL().withMessage('imageUrl must be a valid URL'),
    body('action').isIn(VALID_IMAGE_ACTIONS).withMessage(`action must be one of: ${VALID_IMAGE_ACTIONS.join(',')}`),
];

module.exports= {textActionValidators,imageActionValidators};