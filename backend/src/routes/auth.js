const express= require('express');
const router = express.Router();
const {register,login,getMe}= require("../controllers/authController")
const {authenticate} = require('../middleware/auth');

router.post("/register",register);
router.post("/login",login);
router.post("/me",authenticate,getMe); //protected-token required

module.exports = router;