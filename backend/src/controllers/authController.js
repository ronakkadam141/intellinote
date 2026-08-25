const User= require("../models/User")
const bcrypt=require("bcrypt")
const jwt= require ("jsonwebtoken");
const env = require('../config/env')

// Generates a friendly, always-non-null default name for accounts that
// don't provide one at signup — e.g. "User-4821". Not guaranteed globally
// unique (displayName has no unique constraint in the schema), which is
// fine: it's a display label, not an identifier. Purely eliminates the
// null-displayName class of bug at the source.
function generateDisplayName() {
    const suffix = Math.floor(1000 + Math.random() * 9000); // 4-digit, no leading zero
    return `User-${suffix}`;
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
            // Always non-null now: use what they typed, trimmed, or fall
            // back to a generated name. Never store null/empty again.
            displayName: displayName?.trim() || generateDisplayName(),
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