
const mongoose=require('mongoose');
const Document=require('../models/Document');
const Folder=require('../models/Folder');
const {createTicket} = require('../lib/wsTicketStore')

/**
 * Every new document starts with an empty document not null or empty object 
 * default structure for tiptap
 * invalid initial state causes editor to crash on first l
 */

const EMPTY_DOCUMENT_CONTENT = {
    type : 'doc',
    content : [],
};

/*
    CREATE DOCUMENT
 * creates a new document in workspace 
 * folderId is optional , if omitted, document lives at workspace root
 * 
 * if folderId given, we validate it to workspace and if not archived assign it 
 * 
*/

const createDocument= async(req,res,next)=>{
    try{
        const {workspaceId} = req.params;
        const{title,folderId}=req.body;

        // check if Id provided
        if(folderId){
            if(!mongoose.Types.ObjectId.isValid(folderId)){
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_FOLDER_ID',
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
                        message: 'Folder not found in this workspace.',
                    },
                });
            }
        }
        
        const document= await Document.create({
            title:title?.trim() || 'Untitled',
            content:EMPTY_DOCUMENT_CONTENT,
            workspaceId,
            folderId:folderId || null,
            createdBy:req.user.id,
            lastEditedBy:req.user.id,
            isArchived:false,
            isPinned:false,
            tags:[],
            yjsState:null,
        });

        res.status(201).json({
            success: true,
            data: {
                document: {
                    id: document._id,
                    title: document.title,
                    workspaceId: document.workspaceId,
                    folderId: document.folderId,
                    isPinned: document.isPinned,
                    tags: document.tags,
                    createdBy: document.createdBy,
                    lastEditedBy: document.lastEditedBy,
                    createdAt: document.createdAt,
                    updatedAt: document.updatedAt,
                    // content intentionally omitted from create response —
                    // the editor initialises from EMPTY_DOCUMENT_CONTENT locally
                    // yjsState intentionally omitted — internal collaboration field
                },
            },
        });
        
    }

    catch(err){
        return next(err);
    }
}

/*
    GET DOCUMENT
    
    returns all active docs in the workspace 
    supports optional query param filtering :
        *?folderId=<id>   → documents inside a specific folder
        *   ?folderId=root   → documents at workspace root (folderId: null)
        *   ?tag=<tagname>   → documents with a specific tag
        *   (no params)      → all workspace documents
    
        content and yjsState excluded.
        full content onlu returned by getByDocumentID, which is called when doc opened

        sorted pinned docs first then most recently uploaded

 */

const getDocuments= async(req,res,next)=>{
    try{

        const {workspaceId} = req.params;
        const {folderId,tag} = req.query;

        const filter = {
            workspaceId,
            isArchived:false,
        };

        if(folderId==='root'){
            filter.folderId=null;
        }
        else if(folderId){
            if(!mongoose.Types.ObjectId.isValid(folderId)){
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_FOLDER_ID',
                        message: 'Invalid folder ID format.',
                    },
                });
            }
            filter.folderId=folderId;
        }

        if(tag){
            filter.tags=tag;
        }


        const documents= await Document.find(filter)
        .sort({isPinned: -1, updatedAt:-1})
        .select('-content -yjsState')
        .populate('createdBy','displayName avatarUrl')
        .populate('lastEditedBy','displayName avatarUrl')
        .lean();

        const formatted = documents.map((doc) => ({
            id: doc._id,
            title: doc.title,
            workspaceId: doc.workspaceId,
            folderId: doc.folderId,
            isPinned: doc.isPinned,
            tags: doc.tags,
            createdBy: doc.createdBy,
            lastEditedBy: doc.lastEditedBy,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        }));

        res.status(200).json({
            success:true,
            data:{documents:formatted},
        });
    }

    catch(err){
        return next (err);
    }
};

/*
    Get Document by ID

    returns full document including content
    only endpoint that returns content field, 
    called when user opens doc  in editor 

    yjsState excluded- manages it through its own mech 

    Both _id and workspaceId required in query 
*/

const getDocumentById= async(req,res,next)=>{
    try{
        const{workspaceId,documentId} = req.params;

        if(!mongoose.Types.ObjectId.isValid(documentId)){
            return res.status(400).json({
                success: false,
                error: {
                code: 'INVALID_ID',
                message: 'Invalid document ID format.',
                },
            });
        }

        const document = await Document.findOne({
            _id:documentId,
            workspaceId,
            isArchived:false,
        })  .select('-yjsState')
            .populate('createdBy','displayName avatarUrl')
            .populate('lastEditedBy','displayName avatarUrl')
            .lean()
        
        if(!document){
            return res.status(404).json({
                success: false,
                error: {
                code: 'DOCUMENT_NOT_FOUND',
                message: 'Document not found.',
                },
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                document: {
                    id: document._id,
                    title: document.title,
                    content: document.content,
                    workspaceId: document.workspaceId,
                    folderId: document.folderId,
                    isPinned: document.isPinned,
                    tags: document.tags,
                    images: document.images,
                    createdBy: document.createdBy,
                    lastEditedBy: document.lastEditedBy,
                    createdAt: document.createdAt,
                    updatedAt: document.updatedAt,
                },
            },
        });
    }
    catch(err){
        return next(err);
    }
}

/*
    UPDATE DOCUMENT
 * partial update- only fields present in request body are changed 
    handles:title,content,isPinned,folderId.
 * The ?? (nullish coalescing) pattern is used:
 *   - title: use ?? to preserve existing value when not sent
 *   - folderId: use explicit undefined check because null is a VALID value
 *     (null means "move to workspace root") — ?? would incorrectly skip null
 * 
 * lastEditedBy is always updated when any field changes.
 * This powers the "last edited by X" UI without a separate query.
 * 
 * Tags are NOT updated here — they have their own dedicated endpoint
 * with addToSet/pull semantics that can't be expressed as a simple field update.
 */
const updateDocument= async(req,res,next)=>{
    try{
        const {workspaceId,documentId}=req.params;
        const {title,content,isPinned,folderId}=req.body;

        if(!mongoose.Types.ObjectId.isValid(documentId)){
            return res.status(400).json({
                success: false,
                error: {
                code: 'INVALID_ID',
                message: 'Invalid document ID format.',
                },
            });
        }

        if(folderId!==undefined && folderId!== null){
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
                        message: 'Folder not found in this workspace.',
                    },
                });
            }
        }

        

        const updates= {};;
        if(title!==undefined) updates.title= title.trim()||'Untitled';
        if(content!==undefined)updates.content= content;
        if(isPinned!==undefined) updates.isPinned=isPinned;
        if(folderId!==undefined) updates.folderId = folderId;

        if(Object.keys(updates).length===0){
            return res.status(400).json({
                success: false,
                error: {
                code: 'NO_CHANGES',
                message: 'No valid fields provided to update.',
                },
            });
        }

        updates.lastEditedBy = req.user.id;

        const document= await Document.findOneAndUpdate(
            {_id:documentId,workspaceId,isArchived:false},
            {$set:updates},
            {new:true, runValidators:true},
        )   .select('-yjsState')
            .populate('lastEditedBy','displayName avatarUrl');

        if(!document){
            return res.status(404).json({
                success: false,
                error: {
                code: 'DOCUMENT_NOT_FOUND',
                message: 'Document not found.',
                },
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                document: {
                id: document._id,
                title: document.title,
                folderId: document.folderId,
                isPinned: document.isPinned,
                tags: document.tags,
                lastEditedBy: document.lastEditedBy,
                updatedAt: document.updatedAt,
                },
            },
        });

    }
    catch(err){
        return next(err);
    }
};

/*
 Adds and/or removes tags using atomic MongoDB operators:
 *   $addToSet — adds tags that don't already exist (no duplicates)
 *   $pull     — removes specified tags

 * Both operations can be sent in a single request.
 * Adapted from the old NotesController.updateTags — the cleanest method
 * in the original codebase. Tag validation happens before any DB call.


 * Why a separate endpoint instead of PATCH /documents/:id?
 * Because tag updates have additive/subtractive semantics that can't be
 * expressed as simple field replacement. Merging them into updateDocument
 * would require complex logic to distinguish "replace tags" from "add tags".
*/
const updateDocumentTags = async(req,res,next)=>{
    try{
        const {workspaceId, documentId }=req.params;
        const {add=[],remove=[]}=req.body;

        if(!mongoose.Types.ObjectId.isValid(documentId)){
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_ID',
                    message: 'Invalid document ID format.',
                },
            });
        }

        if(!Array.isArray(add)){
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: '`add` must be an array.' },
            });
        }

        if(!Array.isArray(remove)){
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: '`remove` must be an array.' },
            });
        }

        if(add.some((tag) => typeof tag !== 'string' || !tag.trim())){
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'All tags in `add` must be non-empty strings.' },
            });
        }

        if(remove.some((tag) => typeof tag !== 'string')){
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'All tags in `remove` must be non-empty strings.' },
            });
        }
        
        if(add.length === 0 && remove.length === 0){
            return res.status(400).json({
                success: false,
                error: { code: 'NO_CHANGES', message: 'No tags to add or remove.' },
            });
        }

        const update= {};

        if(add.length > 0){
            update.$addToSet = {tags : {$each: add.map((t)=> t.trim())}};
        }
        if(remove.length >0){
            update.$pull = {tags:{$in : remove}};
        }

        const document= await Document.findOneAndUpdate(
            {_id:documentId,workspaceId,isArchived:false},
            update,
            {new:true},
        )   .select('tags updatedAt');

        if(!document){
            return res.status(404).json({
                success: false,
                error: {
                code: 'DOCUMENT_NOT_FOUND',
                message: 'Document not found.',
                },
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                document: {
                    id: document._id,
                    tags: document.tags,
                    updatedAt: document.updatedAt,
                },
            },
        });

    }
    catch(err){
        return next(err);
    }
}

/**
    ARCHIVE DOCUMENT
 * soft delete document by isarchived:true
    document and content all preserved

    scoped to workspace Id
 */
const archiveDocument= async(req,res,next)=>{
    try{
        const {workspaceId,documentId}=req.params;

        if(!mongoose.Types.ObjectId.isValid(documentId)){
            return res.status(400).json({
                success: false,
                error: {
                code: 'INVALID_ID',
                message: 'Invalid document ID format.',
                },
            });
        }

        const document= await Document.findOneAndUpdate(
            {_id:documentId,workspaceId,isArchived:false},
            {$set:{isArchived:true}},
            {new:true, runValidators:true},
        )   .select('_id title');


        if (!document) {
            return res.status(404).json({
                success: false,
                error: {
                code: 'DOCUMENT_NOT_FOUND',
                message: 'Document not found or already archived.',
                },
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                message: 'Document archived successfully.',
                documentId: document._id,
                title: document.title,
        
            },
        });
    }
    catch(err){
        return next(err)
    }
}

/*
    issue ws ticket

    single use shortlived ticket that authenticates susequent websockets 
    connection for realtime collabs on this document. called once, 
    right before the client opens the WS conection 
    
    Any workspace member can req one read only enforcement for viewers inside the 
    live sesion itself is handled by Yjs server endlpoint confirms: this user can see 
    this workspace and this document actually exists in it
*/

const issueWsTicket = async (req, res, next) => {
    try {
        const { workspaceId, documentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(documentId)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_ID',
                    message: 'Invalid document ID format.',
                },
            });
        }

        const document = await Document.findOne({
            _id: documentId,
            workspaceId,
            isArchived: false,
        }).select('_id').lean();

        if (!document) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'DOCUMENT_NOT_FOUND',
                    message: 'Document not found.',
                },
            });
        }

        const ticket = createTicket({
            userId: req.user.id,
            workspaceId,
            documentId,
            role: req.workspaceMember.role,
        });

        return res.status(201).json({
            success: true,
            data: { ticket },
        });
    } catch (err) {
        return next(err);
    }
};

module.exports={
    createDocument,
    getDocuments,
    getDocumentById,
    updateDocument,
    updateDocumentTags,
    archiveDocument,
    issueWsTicket,
};