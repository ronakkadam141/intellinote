const express= require('express');
const router=express.Router();
const {protect}= require('../middleware/authMiddleware')
const {createFolder,getFolders,deleteFolder}=require('../controllers/folderController')

router.use(protect);

router.post('/',createFolder);
router.get('/',getFolders);
router.delete('/:id',deleteFolder);

module.exports=router;