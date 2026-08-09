const express= require('express');
const router = express.Router({mergeParams:true});

const {
    createDocument,
    getDocuments,
    getDocumentById,
    updateDocument,
    updateDocumentTags,
    archiveDocument,
    issueWsTicket,
}=require("../controllers/documentController");

const {authenticate} = require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {requireWorkspaceRole} = require('../middleware/requireWorkspaceRole');
const validate = require('../validators/validate');
const {createDocumentValidator,updateDocumentValidator,updateTagsValidator,deleteDocumentImageValidator}= require('../validators/documentValidators');
const { deleteDocumentImage } = require('../controllers/imageController');

router.use(authenticate,requireWorkspaceAccess);

router.get("/", getDocuments);
router.get("/:documentId", getDocumentById);

router.post("/:documentId/ws-ticket", issueWsTicket)
router.post('/',requireWorkspaceRole('editor'),createDocumentValidator,validate,createDocument);
router.patch("/:documentId", requireWorkspaceRole('editor'),updateDocumentValidator,validate,updateDocument);
router.patch("/:documentId/tags", requireWorkspaceRole('editor'),updateTagsValidator,validate,updateDocumentTags);
router.delete("/:documentId",requireWorkspaceRole('editor'),archiveDocument);
router.delete("/:documentId/images/:imageId",requireWorkspaceRole('editor'),deleteDocumentImageValidator,validate,deleteDocumentImage)

module.exports = router;