const mongoose=require('mongoose');
const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');
const Document = require('../models/Document');
const Folder = require('../models/Folder');
const { deleteCloudinaryImages } = require('./imageController');
/*
slug generator 
Instead of URLs like: /workspaces/685f8c3a4d2b7e91
we can have:    /workspaces/my-study-group-a3f9

we append a random suffix at the end to handle duplicate names of study groups 
*/
const generateSlug = (name) =>{
    const base=name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')    // strip special characters
        .replace(/\s+/g, '-')            // spaces → hyphens
        .replace(/-+/g, '-');            // collapse consecutive hyphens

    const suffix=Math.random().toString(36).slice(2,6);

    return `${base}-${suffix}`;
};

/*
creates a new workspace and adds creator as owner, 
these writes are wrapped in mongodb session+transaction 
so failure on either leaves database clean

without transaction we would have an ownerless workspace
*/

const createWorkspace = async(req,res,next) =>{
    const session = await mongoose.startSession();

    try{
        const {name,description}=req.body;

        let workspace,membership;

        await session.withTransaction(async()=>{
            [workspace]=await Workspace.create(
                [
                    {
                        name:name.trim(),
                        description:description?.trim() || '',
                        slug: generateSlug(name),
                        ownerId:req.user.id,
                        isArchived:false,
                    },
                ],
                {session}
            );
        
            // Immediately grant the creator owner-level membership.
            // ownerId on Workspace is a safety anchor; this record is what
            // the RBAC middleware actually uses for every subsequent request.
        
            [membership] = await WorkspaceMember.create(
                [
                    {
                        workspaceId:workspace._id,
                        userId:req.user.id,
                        role:'owner',
                        joinedAt:new Date(),
                        invitedBy:null,
                    },
                ],
                {session}
            );
        });

        return res.status(201).json({
            success:true,
            data:{
                workspace:{
                    id:workspace._id,
                    name:workspace.name,
                    description:workspace.description,
                    slug:workspace.slug,
                    role:membership.role,
                    createdAt:workspace.createdAt,
                },
            },
        });
    }
    
    catch(err){
        return next(err);            
    }

    finally{
        session.endSession();
    }
}

/*
    returns all workspaces the autherntiacated user belongs to 
    queries workspacemember first(indexed), then populates workspace details

    user's dashboard data-keep it lean 
    documents are excluded here because they belong to individual workspace 

*/

const getMyWorkspaces = async(req,res,next) => {
    try{
        const memberships = await WorkspaceMember.find({
            userId:req.user.id,
        })  
            .populate({
            path:'workspaceId',
            match:{isArchived:false},
            select:'name description slug createdAt',
            })
            .lean();

        // populate sets field to null when match fails-filter those out 

        const workspaces = memberships 
            .filter((m)=>m.workspaceId !== null) 
            .map((m)=>({
                id:m.workspaceId._id,
                name:m.workspaceId.name,
                description:m.workspaceId.description,
                slug:m.workspaceId.slug,
                role:m.role,
                joinedAt:m.joinedAt,
                createdAt:m.workspaceId.createdAt,
            }));
        
        return res.status(200).json({
            success:true,
            data:{workspaces},
        });
    }

    catch(err){
        console.log(err);
        return next(err);
    }
};

/*

    returns workspace details and the member count
    req.workspaceMember is attached by requireWorkspaceAccess

    Member count is useful for workspace settings UI without exposing full member list 

*/

const getWorkspaceById = async(req,res,next)=>{
    try{
        const {workspaceId} = req.params;

        const workspace = await Workspace.findOne({
            _id:workspaceId,
            isArchived:false,
        })
            .select('name description slug ownerId createdAt updatedAt')
            .lean();

        if(!workspace){
            return res.status(404).json({
                success:false,
                error:{
                    code:'WORKSPACE_NOT_FOUND',
                    message:'Workspace not found or has been archived',
                },
            });
        }

        const memberCount = await WorkspaceMember.countDocuments({workspaceId});

        return res.status(200).json({
            success:true,
            data:{
                workspace:{
                    id:workspace._id,
                    name:workspace.name,
                    description:workspace.description,
                    slug:workspace.slug,
                    role:req.workspaceMember.role,
                    memberCount,
                    createdAt:workspace.createdAt,
                    updatedAt:workspace.updatedAt,
                },
            },
        });
    }

    catch(err){
        return next(err);
    }
    
};

/*

    update workspace name/description.
    slug remains same always, created only once at creation 
    
    Uses {new: true} to return the updated document so the frontend
    can update its state without a follow-up GET.

*/

const updateWorkspace = async(req,res,next)=>{
    try{
        const {workspaceId} = req.params;
        const {name,description} = req.body;

        const updates={};

        if(name!==undefined) updates.name=name.trim();
        if(description!==undefined) updates.description=description.trim();
        
        if(Object.keys(updates).length===0){
            return res.status(400).json({
                success:false,
                error:{
                    code:'NO_CHANGES',
                    message:'No valid fields provided to update.'
                },
            });
        }

        const workspace = await Workspace.findOneAndUpdate(
            {_id:workspaceId, isArchived:false},
            {$set:updates},
            {new:true, runValidators:true}
        ).select('name description slug updatedAt');

        if(!workspace){
            return res.status(404).json({
                success:false,
                error:{
                    code:'WORKSPACE_NOT_FOUND',
                    message:'Workspace not found or has been archived',
                    
                },
            });
        }

        return res.status(200).json({
            success:true,
            data:{
                workspace:{
                    id:workspace._id,
                    name:workspace.name,
                    description:workspace.description,
                    slug:workspace.slug,
                    updatedAt:workspace.updatedAt,
                },
            },
        });
    }
    catch(err){
        console.log(err);
        return next(err);
    }
};

/*
    archive/soft-delete the workspace by setting issArchived:true
    
    doesnt delete workspace member records or documents
    they remain intact for potential recovery 

    Hard delete later

*/

const archiveWorkspace = async(req,res,next)=>{
    try{
        const {workspaceId} = req.params;

        const workspace = await Workspace.findOneAndUpdate(
            {_id:workspaceId,isArchived:false},
            {$set:{isArchived:true}},
            {new:true}
        );

        if(!workspace){
            return res.status(404).json({
                success:false,
                error:{
                    code:'WORKSPACE_NOT_FOUND',
                    message:'Workspace not found or already archived',
                },
            });
        }

        return res.status(200).json({
            success:true,
            data:{
                message:'Workspace archived successfully',
                workspaceId:workspace._id,
            },
        });
    }

    catch(err){
        console.log(err);
        return next(err);
    }
};

/*
 HARD DELETE WORKSPACE

 Permanently deletes the workspace and everything in it: every folder,
 every document (active or archived) and their Cloudinary images, every
 membership record, then the workspace itself. No archive step required —
 owner can go straight to permanent deletion, per product decision.
 Fully irreversible.
*/
const hardDeleteWorkspace = async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
        const { workspaceId } = req.params;

        let imagesToClean = [];
        let deletedDocumentCount = 0;
        let deletedFolderCount = 0;

        await session.withTransaction(async () => {
            const workspace = await Workspace.findById(workspaceId).session(session);

            if (!workspace) {
                const err = new Error('Workspace not found.');
                err.statusCode = 404;
                err.code = 'WORKSPACE_NOT_FOUND';
                throw err;
            }

            const documents = await Document.find({ workspaceId }).select('images').session(session).lean();
            imagesToClean = documents.flatMap((d) => d.images || []);
            deletedDocumentCount = documents.length;

            const folderResult = await Folder.deleteMany({ workspaceId }, { session });
            deletedFolderCount = folderResult.deletedCount;

            await Document.deleteMany({ workspaceId }, { session });
            await WorkspaceMember.deleteMany({ workspaceId }, { session });
            await Workspace.deleteOne({ _id: workspaceId }, { session });
        });

        deleteCloudinaryImages(imagesToClean).catch((err) =>
            console.error('[hardDeleteWorkspace] Cloudinary cleanup error:', err)
        );

        return res.status(200).json({
            success: true,
            data: {
                message: 'Workspace and all its contents permanently deleted.',
                workspaceId,
                deletedFolderCount,
                deletedDocumentCount,
            },
        });
    } catch (err) {
        if (err.statusCode === 404) {
            return res.status(404).json({
                success: false,
                error: { code: err.code, message: err.message },
            });
        }
        return next(err);
    } finally {
        session.endSession();
    }
};

module.exports = {
    createWorkspace,
    getMyWorkspaces,
    getWorkspaceById,
    updateWorkspace,
    archiveWorkspace,
    hardDeleteWorkspace,
};