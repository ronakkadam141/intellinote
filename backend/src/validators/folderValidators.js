const {body} = require('express-validators');

const createFolderValidator = [
    body('name').trim().notEmpty().withMessage('Folder name is required').isLength({max:100}),
];

const updateFolderValidator = [
    body('name').trim().notEmpty().withMessage('Folder name is required').isLength({max:100}),
];

module.exports = {createFolderValidator,updateFolderValidator};