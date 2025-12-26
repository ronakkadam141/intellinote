const User= require("../models/User")
const bcrypt=require("bcrypt")
const jwt= require ("jsonwebtoken")

exports.register = async(req,res) =>{
    console.log("Request body: ",req.body);
    try{
        const {email,password}=req.body;

        const hashedPassword= await bcrypt.hash(password,10);

        const newUser= await User.create({
            email,
            password: hashedPassword,
        });

        res.status(201).json({message: "User Registered!"});
    }
    catch(err){
        console.error(err);
        res.status(400).json({error: err.message});
    }
};

exports.login= async(req,res) =>{
    try{
        const {email,password}=req.body;

        const user = await User.findOne({email});
        if(!user) return res.status(400).json({error:"Invalid credentials"});
        
        const isMatch= await bcrypt.compare(password,user.password);
        if(!isMatch) return res.status(400).json({error:"Incorrect Password"});

        const token =jwt.sign(
            {id:user._id},
            process.env.JWT_SECRET,
            {expiresIn:"1h"}
        );

        res.json({token});
    }
    catch(err){
        res.status(500).json({error:err.message});
    }
};