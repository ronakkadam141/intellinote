const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/upload');
const Document = require('../models/Document');

function uploadBufferToCloudinary(buffer,folder){
    return new Promise((resolve,reject)=>{
        const stream = cloudinary.uploader.upload_stream(
            {folder,resource_type:'image'},
            (err,result)=>{
                if(err) return reject(err);
                resolve(result);
            }
        );
        stream.end(buffer);
    });
}

async function uploadImage(req,res,next){
    try{
        if(!req.file){
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_FILE', message: 'No image file was provided.' },
            });
        }

        const {workspaceId} = req.params;
        const {documentId} = req.body;

        if(documentId){
            const targetExists = await Document.exists({
                _id: documentId,
                workspaceId,
                isArchived : false,
            })

            if(!targetExists){
                return res.status(404).json({
                    success: false,
                    error: {
                        code: 'DOCUMENT_NOT_FOUND',
                        message: 'Target document not found in this workspace.',
                    },
                });
            }
        }
        const result = await uploadBufferToCloudinary(
            req.file.buffer,
            `intellinote/${workspaceId}`
        )

        const imageData = {
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            uploadedAt: new Date(),
        };

        if(documentId){
            await Document.updateOne(
                { _id: documentId, workspaceId },
                {
                    $push: { images: imageData },
                    $set: { lastEditedBy: req.user.id },
                }
            )
        }

        return res.status(201).json({
            success: true,
            data: {
                imageUrl: imageData.url,
                publicId: imageData.publicId,
                width: imageData.width,
                height: imageData.height,
                format: imageData.format,
                documentId: documentId || null,
                updatedAt: imageData.uploadedAt,
                lastEditedBy: documentId ? req.user.id : null,
            },
        });
    }

    catch(err){
        return next(err);
    }
}

async function deleteDocumentImage(req,res,next){
    try{

        const {workspaceId,documentId,imageId} = req.params;

        const document = await Document.findOne({
            _id: documentId,
            workspaceId,
            isArchived : false,
        }); 
        
        if(!document){
            return res.status(404).json({
                success: false,
                error: {
                    code: 'DOCUMENT_NOT_FOUND',
                    message: 'Target document not found in this workspace.',
                },
            });
        }

        const image = document.images.id(imageId);

        if(!image){
            return res.status(404).json({
                success: false,
                error: {
                    code: 'IMAGE_NOT_FOUND',
                    message: 'Image not found in this document.',
                },
            });
        }

        try{
            const cloudResult = await cloudinary.uploader.destroy(image.publicId);
            if(cloudResult.result !== 'ok' && cloudResult.result !=='not found'){
                throw new Error(`Unexpected Cloudinary response: ${cloudResult.result}`);
            }
        }
        catch(cloudErr){
            return res.status(502).json({
                success: false,
                error: {
                    code: 'IMAGE_DELETE_FAILED',
                    message: 'Could not delete the image asset. Please retry.',
                },
            });
        }

        await Document.updateOne(
            { _id: documentId, workspaceId },
            {
                $pull: { images: { _id: imageId } },
                $set: { lastEditedBy: req.user.id },
            }
        )

        return res.status(200).json({
            success: true,
            data: { documentId, imageId },
        });
    }
    catch(err){
        return next(err);
    }
}
module.exports = {uploadImage,deleteDocumentImage};
