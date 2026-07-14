const express = require('express');
const router = express.Router({mergeParams:true});

const {handleTextAction}= require('../controllers/aiController');
const {authenticate}= require('../middleware/auth');
const requireWorkspaceAccess = require('../middleware/requireWorkspaceAccess');

router.post("/text", authenticate,requireWorkspaceAccess,handleTextAction);

module.exports = router;