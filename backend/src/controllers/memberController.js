const User = require('../models/User');
const { default: workspaceMember } = require('../models/WorkspaceMember');
const WorkspaceMember = require('../models/WorkspaceMember');

/*
 * count number of owners in a workspace
 * centralized extracting for convienieance 
*/

const countWorkspaceOwners = (workspaceId) =>{
    return WorkspaceMember.countDocuments({workspaceId,role:'owner'});
};

/*
 * return all members of a workspace with profile and role
 * any member can view memberlist
 
 * populate only safe fields 
 * .lean() used for read performance — we don't need Mongoose document methods here.

*/

const getMembers = async(req,res,next)=>{
    try{
        const {workspaceId}=req.params;

        const members = await WorkspaceMember.find({workspaceId}).populate({path:'userId',select:'displayName email avatarUrl'}).lean();

        const formatted = members.map((m)=>({
            memberId:m._id,
            role:m.role,
            joinedAt:m.joinedAt,
            user:{
                id:m.userId._id,
                displayName:m.userId.displayName,
                email:m.userId.email,
                avatarUrl:m.userId.avatarUrl || null,
            },
        }));

        return res.status(200).json({
            success:true,
            data:{members:formatted},
        });
    }

    catch(err){
        console.log(err);
        return next(err);
    }
};

/**

* adds existing user to workspaace by email address 
assumption: invitee must have an acc alr 

* default role for invitees is editor which can be changed later by owner 

* We do an explicit pre-check for existing membership before creating the record.

*/

const inviteMember = async(req, res , next)=>{
    try{
        const {workspaceId} = req.params;
        const{email,role='editor'} = req.body;

        const INVITABLE_ROLES=['editor','viewer'];
        if(!INVITABLE_ROLES.includes(role)){
            return res.status(400).json({
                success:false,
                error:{
                    code:'INVALID_ROLE',
                    message:`Role must be one of: ${INVITABLE_ROLES.join(', ')}.`
                },
            });
        }

        const targetUser= await User.findOne({
            email:email.toLowerCase().trim(),
        }).select('_id displayName email avatarUrl');

        if(!targetUser){
            return res.status(400).json({
                success:false,
                error:{
                    code:'USER_NOT_FOUND',
                    message:'No account found with the entered email.',
                },
            });
        }

        const existingMembership = await WorkspaceMember.findOne({
            workspaceId,
            userId: targetUser._id,
        }).lean();

        if(existingMembership){
            return res.status(409).json({
                success:false,
                error:{
                    code:'ALREADY_A_MEMBER',
                    message:'This user is already in the workspace',
                },
            });
        }

        const membership= await WorkspaceMember.create({
            workspaceId,
            userId:targetUser._id,
            role,
            joinedAt:new Date(),
            invitedBy:req.user.id,
        });

        return res.status(201).json({
            success:true,
            data:{
                member:{
                    memberId: membership._id,
                    role: membership.role,
                    joinedAt: membership.joinedAt,
                    user: {
                        id: targetUser._id,
                        displayName: targetUser.displayName,
                        email: targetUser.email,
                        avatarUrl: targetUser.avatarUrl || null,
                    },
                },
            },
        });
    }
    catch(err){
        return next(err);
    }
}

/* 
Change Role of workspace memebr 

if member is ONLY OWNER, demoting would make workspace orphan,
so weblock this by checking this case first, 
only done if owner promotes someone else then demotes themselves

we lookup to workspaceId instead of anything to prevent accidental change of member roles in other workspace
*/

const updateMemberRole = async(req,res,next)=>{
    try{
        const {workspaceId,memberId}=req.params;
        const{role}= req.body;

        const VALID_ROLES= ['owner','editor','viewer'];

        if(!VALID_ROLES.includes(role)){
            return res.status(400).json({
                success:false,
                error:{
                    code:'INVALID_ROLE',
                    message:`Role must be one of: ${VALID_ROLES.join(', ')}.`,
                },
            });
        }

        const targetMembership=await workspaceMember.findOne({
            _id:memberId,
            workspaceId,
        });

        if(!targetMembership){
            return res.status(400).json({
                success:false,
                error:{
                    code:'MEMBER_NOT_FOUND',
                    message:'Member not found in the workspace',
                },
            });
        }

        const isDemotingOwner = targetMembership.role === 'owner' && role!=='owner';

        if(isDemotingOwner){
            const ownerCount= await countWorkspaceOwners(workspaceId);

            if(ownerCount<=1){
                return res.status(400).json({
                    success:false,
                    error:{
                    code:'LAST_OWNER',
                        message:'Cannot demote this owner. Promote Another memeber to owner first.',
                    },
                });

            }
        }

        if(targetMembership.role===role){
            return res.status(400).json({
                success:false,
                error:{
                    code:'ROLE_UNCHANGED',
                    message:`Member already has the role '${role}'.`,
                },
            });
        }

        targetMembership.role=role;

        await targetMembership.save();

        return res.status(200).json({
            success:true,
            data:{
                member:{
                    memberId:targetMembership._id,
                    userId:targetMembership.userId,
                    role:targetMembership.role,
                },
            },
        });
    }

    catch(err){
        return next(err);
    }
}

/**
 * REMOVE MEMBER 
 
 Remove a memeber from workspace entirely
 Hard delete workspacememebr record, users contribution,documents remain intact 

 owner cannot be removed while they are sole owner 
 owner can be removed if another exists 

*/

const removeMember = async(req,res,next)=>{
    try{
        const{workspaceId,memberId} = req.params;

        const targetMembership = await WorkspaceMember.findOne({
            _id:memberId,
            workspaceId,
        });

        if(!targetMembership){
            return res.status(404).json({
                success:false,
                error:{
                    code:'MEMBER_NOT_FOUND',
                    message:'Member Not found in this workspace',
                },
            });
        }

        const isSelf= targetMembership.userId.toString() === req.user.id.toString();

        if(isSelf){
            return res.status(400).json({
                success:false,
                error:{
                    code:'CANNOT_REMOVE_SELF',
                    message:'Use the leave workspace endpoint to remove yourself.',
                },
            });
        }

        if(targetMembership.role === 'owner'){
            const ownerCount= await countWorkspaceOwners(workspaceId);
            
            if(ownerCount<=1){
                return res.status(400).json({
                    success:false,
                    error:{
                    code:'LAST_OWNER',
                        message:'Cannot remove this owner.Transfer Ownership first.',
                    },
                });

            }

        }

        await WorkspaceMember.deleteOne({ _id:memberId});

        return res.status(200).json({
            success:true,
            data:{
                message:'Member removed from workspace',
                memberId,
            },
        });
        
    }
    catch(err){
        next(err);
    }
}

/**
 * Leave Workspace
 
    Remove themselves from workspace 

    if user is sole owner they cant leave, only allowed if:
    a. promote another member to owner first,
    b. Archive workspace

    identify users membership via req.workspacemember- attached by requireworspaceaccess already scoped to correct workspace 
    no additional lookup needed
 */

const leaveWorkspace= async(req , res, next)=>{
    try{
        const{workspaceId} = req.params;

        const{role}=req.workspaceMember;

        if(role==='owner'){
            const ownerCount= await countWorkspaceOwners(workspaceId);
            
            if(ownerCount<=1){
                return res.status(400).json({
                    success:false,
                    error:{
                    code:'LAST_OWNER',
                        message:'You are only owner. Either promote another member to owner, or archive workspace',
                    },
                });

            }
        }

        await WorkspaceMember.deleteOne({_id:req.workspaceMember.id});
        
        return res.status(200).json({
            success:true,
            data:{
                message:'You left the workspace',
            },
        });

    }
    catch(err){
        next(err);
    }
}

module.exports={
    getMembers,
    inviteMember,
    updateMemberRole,
    removeMember,
    leaveWorkspace,
}