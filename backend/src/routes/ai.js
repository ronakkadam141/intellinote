const express = require('express');
const router = express.Router({mergeParams:true});

const {authenticate}= require('../middleware/auth');
const {requireWorkspaceAccess} = require('../middleware/requireWorkspaceAccess');
const {textActionValidators,imageActionValidators} = require('../validators/aiValidators');
const validate = require('../validators/validate');
const { textActionLimiter, imageActionLimiter } = require('../middleware/aiRateLimiter');
const {handleTextAction,handleImageAction}= require('../controllers/aiController');

router.post("/text", authenticate,requireWorkspaceAccess,textActionLimiter,textActionValidators,validate,handleTextAction);
router.post("/image", authenticate,requireWorkspaceAccess,imageActionLimiter,imageActionValidators,validate,handleImageAction);

module.exports = router;