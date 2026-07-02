const User= require("../models/User")
const bcrypt=require("bcrypt")
const jwt= require ("jsonwebtoken");
const { get } = require("mongoose");

const register = async(req,res,next) =>{
    console.log("Request body: ",req.body);
    try{
        const {email,password,displayName}=req.body;

        // check for existing acc before hashing 
        const existingUser = await User.findOne({email:email.toLowerCase().trim()});
        if(existingUser){
            return res.status(409).json({
                success:false,
                error:{
                    code:'EMAIL_IN_USE',
                    message:'An account with this email already exists',
                },
            });
        }


        const passwordhash= await bcrypt.hash(password,12);

        const newUser= await User.create({
            email: email.toLoweCase().trim(),
            passwordhash,
            displayName:displayName?.trim() || null,
        });
        
        const token = signToken(user);

        res.status(201).json({
            success:true,
            data:{
                token,
                newUser:{
                    id:newUser._id,
                    email:newUser.email,
                    displayName: newUser.displayName,
                }
            }
        });
    }
    catch(err){
        console.error(err);
        return next(err);
    }
};

const login= async(req,res,next) =>{
    try{
        const {email,password}=req.body;

        const user = await User.findOne({
            email:email.toLowerCase().trim(),
        }).select('+passwordHash');

        if(!user) return res.status(400).json(invalidCredentialsResponse);
        
        const isMatch= await bcrypt.compare(password,user.passwordHash);
        if(!isMatch) return res.status(400).json(invalidCredentialsResponse);

        const token = signToken(user);

        return res.status(200).json({
            success:true,
            data:{
                token,
                user:{
                    id:user._id,
                    email:user.email,
                    displayName: user.displayName,
                    avatarUrl:user.avatarUrl || null,
                },
            },
        });
    }
    catch(err){
        console.log(err);
        return next(err);
    }
};

const getMe = async (req,res,next)=>{
    try{
        const user = await User.findById(req.user.id);

        if(!user){
            // Token valid but user was deleted
            return res.status(404).json({
                success:false,
                error:{
                    code:'USER_NOT_FOUND',
                    message:'User account no longer exists'
                },
            });
        }

        return res.status(200).json({
            success:true,
            data:{
                user:{
                    id:user._id,
                    email:user.email,
                    displayName:user.displayName,
                    avatarUrl:user.avatarUrl || null,
                    createdAt:user.createdAt,
                },
            },
        });
    }
    catch(err){
        console.log(err);
        return next(err);
    }
};

module.exports={register,login,getMe};