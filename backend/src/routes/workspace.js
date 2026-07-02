const express = require('express');
const router = express.Router();

const {
    createWorkspace,
    getMyWorkspaces,
    getWorkspaceById,
    updateWorkspace,
    archiveWorkspace,
} = require('../controllers/workspaceController');

const {authenticate}=require('../middleware/auth');
const {requireWorkspaceAccess}= require('../middleware/requireWorkspaceAccess');
const {requiteWorkspaceRole, requireWorkspaceRole}=require('../middleware/requireWorkspaceRole');

// public to authenticated users
router.get('/',authenticate,getMyWorkspaces);
router.post('/',authenticate,createWorkspace);

// workspace scoped:any member
router.get('/:workspaceId',authenticate,requireWorkspaceAccess,getWorkspaceById);

// workspace scoped:owner only 
router.patch('/:workspaceId',authenticate,requireWorkspaceAccess,requireWorkspaceRole('owner'),updateWorkspace);
router.patch('/:workspaceId',authenticate,requireWorkspaceAccess,requireWorkspaceRole('owner'),archiveWorkspace);

module.exports=router;