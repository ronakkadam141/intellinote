const express= require('express');

const router = express.Router({mergeParams:true});

const{
    getMembers,
    inviteMember,
    updateMemberRole,
    removeMember,
    leaveWorkspace,
} = require('../controllers/memberController');

const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');
const validate = require('../validators/validate');
const {registerValidator,loginValidator}= require('../validators/authValidators');
const { inviteMemberValidator, updateMemberRoleValidator } = require('../validators/memberValidators');

router.use(authenticate,requireWorkspaceAccess);

router.get('/',getMembers);

router.delete('/leave',leaveWorkspace);

router.post('/invite',requireWorkspaceRole('owner'),inviteMemberValidator,validate,inviteMember);

router.patch('/:memberId/role',requireWorkspaceRole('owner'),updateMemberRoleValidator,validate,updateMemberRole);

router.delete('/:memberId',requireWorkspaceRole('owner'),removeMember);

module.exports=router;