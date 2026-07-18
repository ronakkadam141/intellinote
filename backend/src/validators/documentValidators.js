const {body,param} = require('express-validators');

const createDocumentValidator=[
    body('title').optional().isString().trim().isLength({max:200}),
    body('folderId').optional({nullable:true}).isMongoId().withMessage('folderId must be a valid ID or null'),
];

const updateDocumentValidator = [
    body('title').optional().isString().trim().isLength({max:200}),
    body('isPinned').optional().isBoolean(),
    body('folderId').optional({nullable:true}).isMongoId().withMessage('folderId must be a valid ID or null'),
    body('content').optional().isObject().withMessage('content must be a ProseMissor JSON object.'),
];

const updateTagsValidator = [
    body('add').optional().isArray().withMessage('add must be an array of strings'),
    body('add.*').optional().isString().trim().isLength({max:30}),
    body('remove').optional().isArray().withMessage('remove must be an array of strings'),
    body('remove.*').optional().isString().trim().isLength({max:30}),
];

const deleteDocumentImageValidator = [
    param('documentId').isMongoId().withMessage('Invalid document ID.'),
    param('imageId').isMongoId().withMessage('Invalid image ID.'),
]

module.exports= {
    createDocumentValidator,
    updateDocumentValidator,
    updateTagsValidator,
    deleteDocumentImageValidator,
};