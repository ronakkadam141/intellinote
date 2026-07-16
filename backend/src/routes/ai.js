const express = require('express');
const router = express.Router({mergeParams:true});

const {handleTextAction,handleImageAction}= require('../controllers/aiController');
const {authenticate}= require('../middleware/auth');
const requireWorkspaceAccess = require('../middleware/requireWorkspaceAccess');
const validate = require('../validators/validate');
const {textActionValidators,imageActionValidators} = require('../validators/aiValidators');

router.post("/text", authenticate,requireWorkspaceAccess,textActionValidators,validate,handleTextAction);
router.post("/image", authenticate,requireWorkspaceAccess,imageActionValidators,validate,handleImageAction);

module.exports = router;