const {body} = require('express-validators');

const uploadImageValidator = [
    body('documentId').optional().isMongoId().withMessage('documentId must be a valid Mongo ID.'),
];

module.exports = {uploadImageValidator};