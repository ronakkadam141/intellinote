const express= require('express');
const router = express.Router();
const {protect}= require('../middleware/authMiddleware')
const {createNote,getNotes,updateNote,deleteNote,getNotesByFolder,getNotesByTag, assignFolder, updateTags}=require("../controllers/notesController");

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
