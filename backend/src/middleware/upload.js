const multer = require('multer');

const MAX_FILE_SIZE = 10*1024*1024;

const storage = multer.memoryStorage();

function fileFilter(req,file,cb){
    if(!file.mimetype.startswith('image/')){
            return cb(new Error('Only image files are allowed.'));
    }
    cb(null,true);
}

const upload = multer({
    storage,
    limits:{fileSize:MAX_FILE_SIZE},
    fileFilter
})

module.exports=upload;