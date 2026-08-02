const {body} = require('express-validator');
const mongoose = require('mongoose');

const validateParentFolderId =(value) =>{
    if(value==null) return true;

    if(!mongoose.Types.ObjectId.isValid(value)){
        throw new Error('Invalid Parent Folder Id format');
    }

    return true;
};
const createFolderValidator = [
    body('name').trim().notEmpty().withMessage('Folder name is required').isLength({max:100}),
    body('parentFolderId').optional({nullable:true}).custom(validateParentFolderId),
];

const updateFolderValidator = [
    body('name').optional().trim().notEmpty().withMessage('Folder name is required').isLength({max:100}),
    body('parentFolderId').optional({nullable:true}).custom(validateParentFolderId),
];

module.exports = {createFolderValidator,updateFolderValidator};