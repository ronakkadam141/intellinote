const express= require('express');
const router=express.Router({mergeParams:true});

const upload = require('../middleware/upload');
const {uploadImage} = require('../controllers/imageController');
const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');
const validate = require('../validators/validate');
const {uploadImageValidator} = require('../validators/imageValidators');
// multer's errors (bad file type, too large) don't go through our normal
// try/catch - this wrapper catches them and replies with the standard
// error envelope instead of letting them fall through as raw text.

function handleUpload(req,res,next){
    upload.single('image')(req,res,(err)=>{
        if(err){
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                success: false,
                error: { code: 'FILE_TOO_LARGE', message: 'Image exceeds the 10MB limit.' },
                });
            }
            return res.status(400).json({
                success: false,
                error: { code: 'UPLOAD_ERROR', message: err.message },
            });
        }
        next();
    });
}

router.post(
    '/',
    authenticate,
    requireWorkspaceAccess,
    requireWorkspaceRole('editor'),
    handleUpload,
    uploadImageValidator,
    validate,
    uploadImage
);

module.exports=router;