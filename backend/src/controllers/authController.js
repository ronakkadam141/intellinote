const User= require("../models/User")
const bcrypt=require("bcrypt")
const jwt= require ("jsonwebtoken");
const env = require('../config/env')

// Generates a friendly default name and guarantees it's actually unique
// in the DB before returning it — required now that displayName has a
// unique index. Retries with a fresh random suffix on collision; falls
// back to a much larger random range after a few attempts as a safety
// net against pathological bad luck.
async function generateDisplayName() {
    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const candidate = `User-${suffix}`;
        const exists = await User.exists({ displayName: candidate });
        if (!exists) return candidate;
    }
    // Extremely unlikely fallback: much larger space, effectively collision-free
    return `User-${Math.floor(100000 + Math.random() * 900000)}`;
}

function signToken(user){
    return jwt.sign(
        {id:user._id,email:user.email},
        env.JWT_SECRET,
        {expiresIn:env.JWT_EXPIRES_IN || '7d'}
    );
}

const invalidCredentialsResponse = {
    success:false,
    error:{
        code:'INVALID_CREDENTIALS',
        message:'Invalid Email or password'
    },
}

const register = async(req,res,next) =>{
    try{
        const {email,password,displayName}=req.body;

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

        const passwordHash= await bcrypt.hash(password,12);

        const newUser= await User.create({
            email: email.toLowerCase().trim(),
            passwordHash,
            displayName: displayName?.trim() || await generateDisplayName(),
        });
        
        const token = signToken(newUser);

        res.status(201).json({
            success:true,
            data:{
                token,
                newUser:{
                    id:newUser._id,
                    email:newUser.email,
                    displayName: newUser.displayName,
                    avatarUrl:newUser.avatarUrl || null,
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

        if(!user) return res.status(401).json(invalidCredentialsResponse);
        
        const isMatch= await bcrypt.compare(password,user.passwordHash);
        if(!isMatch) return res.status(401).json(invalidCredentialsResponse);

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
        return next(err);
    }
};

const getMe = async (req,res,next)=>{
    try{
        const user = await User.findById(req.user.id);

        if(!user){
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

// Lets a user change the auto-generated (or self-chosen) name later, per
// your requirement: "if they want they can change it."
const updateDisplayName = async (req, res, next) => {
    try {
        const { displayName } = req.body;
        const trimmed = displayName?.trim();

        if (!trimmed) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_NAME', message: 'Display name cannot be empty.' },
            });
        }

        // Pre-check for uniqueness before attempting the write — gives a
        // clean, expected error instead of a raw Mongo duplicate-key
        // exception surfacing as a generic 500. Excludes the user's own
        // current record so re-saving your own unchanged name doesn't
        // falsely collide with yourself.
        const existing = await User.findOne({
            displayName: trimmed,
            _id: { $ne: req.user.id },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: { code: 'DISPLAY_NAME_TAKEN', message: 'That display name is already in use.' },
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { displayName: trimmed },
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    displayName: user.displayName,
                    avatarUrl: user.avatarUrl || null,
                },
            },
        });
    } catch (err) {
        return next(err);
    }
};

module.exports={register,login,getMe,updateDisplayName};