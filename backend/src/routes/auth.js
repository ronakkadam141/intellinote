const express= require('express');
const router = express.Router();
const {register,login,getMe}= require("../controllers/authController")
const {authenticate} = require('../middleware/auth');
const validate = require('../validators/validate');
const {registerValidator,loginValidator}= require('../validators/authValidators')

router.post("/register",registerValidator,validate,register);
router.post("/login",loginValidator,validate,login);
router.get("/me",authenticate,getMe); //protected-token required

module.exports = router;