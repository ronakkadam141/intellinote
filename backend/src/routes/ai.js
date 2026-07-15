const express = require('express');
const router = express.Router({mergeParams:true});

const {handleTextAction,handleImageAction}= require('../controllers/aiController');
const {authenticate}= require('../middleware/auth');
const requireWorkspaceAccess = require('../middleware/requireWorkspaceAccess');

router.post("/text", authenticate,requireWorkspaceAccess,handleTextAction);
router.post("/image", authenticate,requireWorkspaceAccess,handleImageAction);

module.exports = router;