const express= require('express');
const router=express.Router({mergeParams:true});
const {createFolder,getFolders,getFolderById,updateFolder,archiveFolder}=require('../controllers/folderController');

const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');
const validate = require('../validators/validate');
const {createFolderValidator,updateFolderValidator}= require('../validators/folderValidators')

router.use(authenticate,requireWorkspaceAccess);

router.get('/',getFolders);
router.get('/:folderId',getFolderById);

router.post('/',requireWorkspaceRole('editor'),createFolderValidator,validate,createFolder);
router.patch('/:folderId',requireWorkspaceRole('editor'),updateFolderValidator,validate,updateFolder);
router.delete('/:folderId',requireWorkspaceRole('editor'),archiveFolder);

module.exports=router;