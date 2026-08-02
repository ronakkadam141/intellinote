const Folder = require('../models/Folder');
const mongoose = require('mongoose');
const Document = require('../models/Document');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
CREATE FOLDER 

Creates new folder inside workspace 

Folder names must be unique whithin workspace.
compound index {workspaceId,name } enforces this at DB level.

names are case sensitive compared on precheck stores as provided. 
Notes and notes would pass precheck but collide at index, this we normalize to lowercase 
*/
const createFolder= async(req ,res, next)=>{
    try{
        const {workspaceId} = req.params;
        const {name,parentFolderId}= req.body;

        if(!name || !name.trim()){
            return res.status(400).json({
                success:false,
                error:{
                    code:'MISSING_NAME',
                    message:'Folder name is required.',
                },
            });
        }

        const trimmedName=name.trim();
        const escapedName = escapeRegex(trimmedName);

        let normalizedParentId = null;

        if(parentFolderId !== undefined && parentFolderId !==null){
            if(!mongoose.Types.ObjectId.isValid(parentFolderId)){
                return res.status(400).json({
                    success: false,
                    error: { 
                        code: 'INVALID_PARENT_ID', 
                        message: 'Invalid parent folder ID format.' 
                    },
                });
            }

            const parent = await Folder.findOne({
                _id:parentFolderId,
                workspaceId,
                isArchived:false,
            }).lean();

            if(!parent){
                return res.status(400).json({
                    success: false,
                    error: { 
                        code: 'PARENT_NOT_FOUND', 
                        message: 'Parent folder not found in workspace.' 
                    },
                });
            }

            normalizedParentId=parent._id;
        }

        const existing = await Folder.findOne({
            workspaceId,
            parentFolderId:normalizedParentId,
            name:{$regex: `^${escapedName}$`, $options: 'i'},
            isArchived:false,
        }).lean();

        if(existing){
            return res.status(409).json({
                success:false,
                error:{
                    code:'FOLDER_NAME_TAKEN',
                    message:`Folder named "${trimmedName}" already exists in this workspace.`,
                },
            });
        }

        const folder= await Folder.create({
            name:trimmedName,
            workspaceId,
            parentFolderId:normalizedParentId,
            createdBy:req.user.id,
            isArchived:false,
        });

        return res.status(201).json({
            success:true,
            data:{
                folder:{
                    id: folder._id,
                    name: folder.name,
                    workspaceId: folder.workspaceId,
                    parentFolderId: folder.parentFolderId,
                    createdBy: folder.createdBy,
                    createdAt: folder.createdAt,
                },
            },
        });
    }
    catch(err){
        next(err);
    }
}

/*
 *GET FOLDERS
 
 returns all non archived folders in workspace 
 soeted alphabatically by name, for sidebar rendering
 
 doesnt return document counts per folder 

 If the frontend needs counts, add a separate aggregation endpoint post-MVP
 rather than making this query heavier for all callers.
 */
const getFolders= async(req,res,next)=>{
    try{
        const {workspaceId}= req.params;
        const {parentId} = req.query;

        const filter = {workspaceId,isArchived:false};

        if(!parentId || parentId === 'root'){
            filter.parentFolderId=null;
        }
        else{
            if(!mongoose.Types.ObjectId.isValid(parentId)){
                return res.status(400).json({
                    success: false,
                    error: { 
                        code: 'INVALID_PARENT_ID', 
                        message: 'Invalid parent folder ID format.' 
                    },
                });
            }
            filter.parentFolderId = parentId;
        }
        const folders= await Folder.find(filter).sort({name:1});

        const formatted = folders.map((f)=>({
            id: f._id,
            name:f.name,
            workspaceId:f.workspaceId,
            parentFolderId:f.parentFolderId,
            createdAt:f.createdAt,
            updatedAt:f.updatedAt,
        }));

        return res.status(200).json({
            success:true,
            data:{folders: formatted},
        });
    }
    catch(err){
        next(err);
    }
}

/*
GET FOLDER BY ID 

returns a single folder 
scoped to workspace id, thus 
a valid folderId from diff workspace returns 404
*/
const getFolderById= async(req,res,next)=>{
    try{
        const{workspaceId,folderId}= req.params;

        if(!mongoose.Types.ObjectId.isValid(folderId)){
            return res.status(400).json({
                success: false,
                error: {
                  code: 'INVALID_ID',
                  message: 'Invalid folder ID format.',
                },
            });
        }

        const folder = await Folder.findOne({
            _id:folderId,
            workspaceId,
            isArchived:false,
        }).lean(); 

        if(!folder){
            return res.status(404).json({
                success: false,
                error: {
                  code: 'FOLDER_NOT_FOUND',
                  message: 'FOlder not found',
                },
            });
        }
        return res.status(200).json({
            success: true,
            data: {
                folder: {
                    id: folder._id,
                    name: folder.name,
                    workspaceId: folder.workspaceId,
                    parentFolderId:folder.parentFolderId,
                    createdBy: folder.createdBy,
                    createdAt: folder.createdAt,
                    updatedAt: folder.updatedAt,
                },
            },
        });
    }
    catch(err){
        next(err);
    }
}
/*
get descendants  
 *Helper function BFS down a folder, collecting every descendant folder ID. 
*/

const getDescendantsFolderIds = async(rootFolderId,workspaceId,session) =>{
    const descendantIds = [];
    let frontier = [rootFolderId];

    while(frontier.length>0){
        const children = await Folder.find({
            workspaceId,
            parentFolderId:{$in:frontier},
            isArchived:false,
        }).select('_id').session(session||null).lean();

        const childIds = children.map((c)=>c._id);
        descendantIds.push(...childIds);
        frontier=childIds;
    }

    return descendantIds;
}



/* 
UPDATE FOLDER

Rename a folder

Same duplicate-name precheck as create folder applies here 
we exclude folder being renamed from uniqueness check, 
to avoid conflict with itself 
*/
const updateFolder= async(req,res,next)=>{
    try{
        const{workspaceId,folderId}= req.params;
        const{name,parentFolderId}=req.body;

        if(!mongoose.Types.ObjectId.isValid(folderId)){
            return res.status(400).json({
                success: false,
                error: {
                  code: 'INVALID_ID',
                  message: 'Invalid folder ID format.',
                },
            });
        } 

        if(name===undefined && parentFolderId===undefined){
           return res.status(400).json({
                success: false,
                error: {
                  code: 'MISSING_NAME',
                  message: 'Folder Name is required.',
                },
            }); 
        }

        const folder = await Folder.findOne({
            _id:folderId,
            workspaceId,
            isArchived:false,
        });

        if(!folder){
            return res.status(404).json({
                success: false,
                error: {
                  code: 'FOLDER_NOT_FOUND',
                  message: 'Folder not found.',
                },
            });
        }

        let targetParentId = folder.parentFolderId;

        if(parentFolderId!== undefined){
            if(parentFolderId === null){
                targetParentId=null;
            }
            else{
                if(!mongoose.Types.ObjectId.isValid(parentFolderId)){
                    return res.status(400).json({
                        success: false,
                        error: {
                        code: 'INVALID_PARENT_ID',
                        message: 'Invalid folder ID format.',
                        },
                    });
                } 

                if(parentFolderId === String(folder._id)){
                    return res.status(400).json({
                        success: false,
                        error: {
                        code: 'INVALID_MOVE',
                        message: 'Folder cannot be moved into itself.',
                        },
                    });
                }

                const newParent = await Folder.findOne({
                    _id:parentFolderId,
                    workspaceId,
                    isArchived:false,
                }).lean();

                if(!newParent){
                    return res.status(404).json({
                        success: false,
                        error: {
                        code: 'PARENT_FOLDER_NOT_FOUND',
                        message: 'Parent folder not found in this worksapce.',
                        },
                    });
                }

                const descendantIds = await getDescendantsFolderIds(folder._id,workspaceId);
                const descendantIdStrings = descendantIds.map((id)=>String(id));

                if(descendantIdStrings.includes(String(newParent._id))){
                    return res.status(400).json({
                        success: false,
                        error: {
                        code: 'INVALID_MOVE',
                        message: 'Folder cannot be moved into its own subFolders.',
                        },
                    });
                
                }

                targetParentId = newParent._id;
            }
        }

        const nextName = name !== undefined ? name.trim() : folder.name;

        if(name !== undefined && !nextName){
            return res.status(400).json({
                success: false,
                error: {
                code: 'MISSING_NAME',
                message: 'Folder name cannot be empty.',
                },
            });
        }

        const nameOrParentChanged = nextName.toLowerCase() !==folder.name.toLowerCase() || String(targetParentId) !== String(folder.parentFolderId);

        if(!nameOrParentChanged){
            return res.status(400).json({
                success: false,
                error: {
                code: 'NO_CHANGES',
                message: 'No changes from current name/location.',
                },
            });
        }

        const escapedName = escapeRegex(nextName);

        const conflict = await Folder.findOne({
            workspaceId,
            parentFolderId:targetParentId,
            name: { $regex: `^${escapedName}$`, $options: 'i' },
            isArchived: false,
            _id: { $ne: folderId },
        }).lean();

        if(conflict){
            return res.status(409).json({
                success: false,
                error: {
                  code: 'FOLDER_NAME_TAKEN',
                  message: `A folder named "${nextName}" already exists in this workspace.`,
                },
            });
        }

        folder.name= nextName;
        folder.parentFolderId= targetParentId;
        await folder.save();

        return res.status(200).json({
            success: true,
            data: {
                folder: {
                    id: folder._id,
                    name: folder.name,
                    workspaceId: folder.workspaceId,
                    parentFolderId: folder.parentFolderId,
                    updatedAt: folder.updatedAt,
                },
            },
        });
    }  
    catch(err){
        next(err);
    }
}

/*
 ARCHIVE FOLDER 
 
 solft delete folder by setting isArchived:true

 documents inside archived folder ARE NOT archived, 
 they are unfiled, folderid set to null, so they appear at root. 
 this prevents silent data loss 

 cascade archive, all documents of archived folder gets archived,
 is dangerous UC 

 archive folder+unfile documents wrapped in a transaction.
 thus incomplete step doesnt occur
 */
const archiveFolder = async (req,res,next)=>{

    const session = await mongoose.startSession();
    try{
        const {workspaceId, folderId}= req.params;

        if(!mongoose.Types.ObjectId.isValid(folderId)){
            return res.status(400).json({
                success: false,
                error: {
                  code: 'INVALID_ID',
                  message: 'Invalid folder ID format.',
                },
            });
        } 

        let archivedFolderIds=[]; 
        let unfiledCount=0;
        

        await session.withTransaction(async()=>{

            const rootFolder = await Folder.findOne({
                _id:folderId,
                workspaceId,
                isArchived:false,
            }).session(session);

            if(!rootFolder){
                const err = new Error('Folder not found');
                err.statusCode = 404;
                err.code ='FOLDER_NOT_FOUND';
                throw err;
            }

            const descendantIds = await getDescendantsFolderIds(rootFolder._id,workspaceId,session);
            archivedFolderIds = [rootFolder._id, ...descendantIds];

            await Folder.updateMany(
                {_id:{$in:archivedFolderIds}},
                {$set:{isArchived:true}},
                {session}
            )

            const result = await Document.updateMany(
                {
                    folderId : {$in:archivedFolderIds},
                    workspaceId,
                    isArchived:false,
                },
                {$set:{folderId:null}},
                {session}
            );

            unfiledCount = result.modifiedCount;
        });

        return res.status(200).json({
            success: true,
            data: {
                message: 'Folder archived. Documents have been moved to workspace root.',
                folderId,
                archivedFolderCount : archivedFolderIds.length,
                unfiledDocuments: unfiledCount,
            },
        });
    }
    
    catch (err) {
    // Handle the manually thrown 404 from inside the transaction
        if (err.statusCode === 404) {
          return res.status(404).json({
            success: false,
            error: {
              code: err.code,
              message: err.message,
            },
          });
        }
        return next(err);
    } 
    
    finally {
        session.endSession();
    }
};

module.exports = {
    createFolder,
    getFolders,
    getFolderById,
    updateFolder,
    archiveFolder,
}