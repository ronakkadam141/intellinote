const express= require('express');
const router=express.Router({mergeParams:true});

const upload = require('../middleware/upload');
const {uploadImage} = require('../controllers/imageController');
const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');

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

router.post('/',authenticate,requireWorkspaceAccess,requireWorkspaceRole('editor'),handleUpload,uploadImage);

module.exports=router;