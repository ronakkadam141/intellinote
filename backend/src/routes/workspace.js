const express = require('express');
const router = express.Router();

const {
    createWorkspace,
    getMyWorkspaces,
    getWorkspaceById,
    updateWorkspace,
    archiveWorkspace,
    hardDeleteWorkspace,
} = require('../controllers/workspaceController');

const {authenticate}=require('../middleware/auth');
const {requireWorkspaceAccess}= require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole}=require('../middleware/requireWorkspaceRole');
const validate = require('../validators/validate');
const {createWorkspaceValidator,updateWorkspaceValidator}= require('../validators/workspaceValidators')

// public to authenticated users
router.get('/',authenticate,getMyWorkspaces);
router.post('/',authenticate,createWorkspaceValidator,validate, createWorkspace);

// workspace scoped:any member
router.get('/:workspaceId',authenticate,requireWorkspaceAccess,getWorkspaceById);

// workspace scoped:owner only 
router.patch('/:workspaceId',authenticate,requireWorkspaceAccess,requireWorkspaceRole('owner'),updateWorkspaceValidator,validate,updateWorkspace);
router.delete('/:workspaceId',authenticate,requireWorkspaceAccess,requireWorkspaceRole('owner'),archiveWorkspace);
router.delete('/:workspaceId/permanent', authenticate, requireWorkspaceAccess, requireWorkspaceRole('owner'), hardDeleteWorkspace);
module.exports=router;