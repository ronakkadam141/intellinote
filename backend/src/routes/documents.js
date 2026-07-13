const express= require('express');
const router = express.Router();
const {protect}= require('../middleware/auth')
const {createNote,getNotes,updateNote,deleteNote,getNotesByFolder,getNotesByTag, assignFolder, updateTags}=require("../controllers/documentController");

router.use(protect);

router.post("/", createNote);
router.get("/", getNotes);

// filtering
router.get("/folder/:folderId", getNotesByFolder);
router.get("/tag/:tag", getNotesByTag);

//  SPECIFIC routes FIRST
router.patch("/:id/tags", updateTags);
router.patch("/:id/folder", assignFolder);

// generic
router.put("/:id", updateNote);
router.delete("/:id", deleteNote);
module.exports = router;