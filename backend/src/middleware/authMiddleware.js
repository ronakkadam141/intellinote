const jwt= require('jsonwebtoken');

const protect = async(req,res,next) =>{
    let token;

    if(req.headers.authorization && req.headers.authorization.startsWith('Bearer')){
        try{
            token=req.headers.authorization.split(' ')[1];

            const decoded=jwt.verify(token,process.env.JWT_SECRET);

            req.userID=decoded.id;

            return next();
        }   
        catch(error){
            console.log("Token Failed");
            return res.status(401).json({message: 'Not authorized'});
        }
    }
    

    if(!token){
        console.log("No token");
        return res.status(401).json({message:"Not Authorized"});
    }
};

module.exports={protect};