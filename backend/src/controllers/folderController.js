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
        const {name}= req.body;

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

        const existing = await Folder.findOne({
            workspaceId,
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

        const folders= await Folder.find({
            workspaceId,
            isArchived:false,
        }).sort({name:1});

        const formatted = folders.map((f)=>({
            id: f._id,
            name:f.name,
            workspaceId:f.workspaceId,
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
UPDATE FOLDER

Rename a folder

Same duplicate-name precheck as create folder applies here 
we exclude folder being renamed from uniqueness check, 
to avoid conflict with itself 
*/

const updateFolder= async(req,res,next)=>{
    try{
        const{workspaceId,folderId}= req.params;
        const{name}=req.body;

        if(!mongoose.Types.ObjectId.isValid(folderId)){
            return res.status(400).json({
                success: false,
                error: {
                  code: 'INVALID_ID',
                  message: 'Invalid folder ID format.',
                },
            });
        } 

        if(!name || !name.trim()){
           return res.status(400).json({
                success: false,
                error: {
                  code: 'MISSING_NAME',
                  message: 'Folder Name is required.',
                },
            }); 
        }

        const trimmedName= name.trim();
        const escapedName= escapeRegex(trimmedName);

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

        if(folder.name.toLowerCase()===trimmedName.toLowerCase()){
            return res.status(400).json({
                success: false,
                error: {
                  code: 'NAME_UNCHANGED',
                  message: 'New Name same as current name.',
                },
            });
        }

        const conflict = await Folder.findOne({
            workspaceId,
            name: { $regex: `^${escapedName}$`, $options: 'i' },
            isArchived: false,
            _id: { $ne: folderId },
        }).lean();

        if(conflict){
            return res.status(409).json({
                success: false,
                error: {
                  code: 'FOLDER_NAME_TAKEN',
                  message: `A folder named "${trimmedName}" already exists in this workspace.`,
                },
            });
        }

        folder.name= trimmedName;

        await folder.save();

        return res.status(200).json({
            success: true,
            data: {
                folder: {
                    id: folder._id,
                    name: folder.name,
                    workspaceId: folder.workspaceId,
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

        let archivedFolder; 
        let unfiledCount;

        await session.withTransaction(async()=>{

            // Step 1 - archive folder
            archivedFolder = await Folder.findOneAndUpdate(
                {_id: folderId, workspaceId, isArchived:false},
                {$set : {isArchived:true}},
                {new:true,session}
            );

            if(!archivedFolder){
                // throw error and automatic rollback
                const err = new Error('Folder not found');
                err.statusCode= 404;
                err.code= 'FOLDER_NOT_FOUND';
                throw err;
            }

            // step 2 unfile all document that belong to this folder 

            const result = await Document.updateMany(
                {
                    folderId,
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