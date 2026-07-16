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
const validate = require('../validators/validate');
const {createDocumentValidator,updateDocumentValidator,updateTagsValidator}= require('../validators/documentValidators')

router.use(authenticate,requireWorkspaceAccess);

router.get("/", getDocuments);
router.get("/:documentId", getDocumentById);

router.post('/',requireWorkspaceRole('editor'),createDocumentValidator,validate,createDocument);
router.patch("/:documentId", requireWorkspaceRole('editor'),updateDocumentValidator,validate,updateDocument);
router.patch("/:documentId/tags", requireWorkspaceRole('editor'),updateDocumentValidator,validate,updateDocumentTags);
router.delete("/:documentId",requireWorkspaceRole('editor'),archiveDocument);

module.exports = router;