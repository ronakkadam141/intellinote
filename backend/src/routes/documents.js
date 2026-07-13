const express= require('express');
const router = express.Router({mergeParams:true});

const {
    createDocument,
    getDocuments,
    getDocumentById,
    updateDocument,
    updateDocumentTags,
    archiveDocument,
}=require("../controllers/documentController");

const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');

router.use(authenticate,requireWorkspaceAccess);

router.get("/", getDocuments);
router.get("/:documentId", getDocumentById);

router.post('/',requireWorkspaceAccess('editor'),createDocument);
router.patch("/:documentId", requireWorkspaceAccess('editor'),updateDocument);
router.patch("/:documentId/tags", requireWorkspaceAccess('editor'),updateDocumentTags);
router.delete("/:documentId",requireWorkspaceAccess('editor'),archiveDocument);

module.exports = router;