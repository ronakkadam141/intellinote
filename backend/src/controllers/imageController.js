const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/upload');

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

        const result = await uploadBufferToCloudinary(
            req.file.buffer,
            `intellinote/${workspaceId}`
        )

        return res.status(201).json({
            success: true,
            data: {
                imageUrl: result.secure_url,
                publicId: result.public_id,
                width: result.width,
                height: result.height,
                format: result.format,
            },
        });
    }

    catch(err){
        return next(err);
    }
}

module.exports = {uploadImage};
