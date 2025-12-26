const Folder = require('../models/Folder');

const createFolder=async(req,res)=>{
    try{
        const{title}=req.body;
        
        const folder= await Folder.create({
            title,
            user:req.userID
        })
        
        res.status(201).json(folder);
    }
    catch(error){
        if(error.code===11000){
            return res.status(409).json({message:"Folder already exists"});
        }
        res.status(500).json({message:"Failed to create notes."})
    }
};

const getFolders=async(req,res)=>{
   try{
        const folders= await Folder.find({
            user: req.userID,
            isArchived:false,
        }).sort({updatedAt:-1});
        
        res.status(200).json(folders);
    }
   catch(error){
        res.status(500).json({message:"Failed to retrieve folders."})
    } 
};

const deleteFolder=async(req,res)=>{
    try{
        const folderID=req.params.id;
    
        const folder= await Folder.findOneAndUpdate(
            {_id:folderID, user:req.userID},
            {isArchived:true},
            {new:true}
        );
    
        if(!folder){
            return res.status(403).json({ message: "Not authorized to delete this folder" });
        }
        
        res.status(200).json({message:"Folder archived successfully"})
            
    }
    catch(error){
        res.status(500).json({message:"Failed to delete folders."})
    }
}

module.exports={
    createFolder,getFolders,deleteFolder
};