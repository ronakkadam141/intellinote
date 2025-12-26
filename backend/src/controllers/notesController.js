const Note=require('../models/Note');
const Folder=require('../models/Folder');
const mongoose=require('mongoose')
const createNote= async(req,res)=>{
    try{
        const{title,content}=req.body;

        const note= await Note.create({
            title,
            content,
            user:req.userID
        })

        res.status(201).json(note);
    }
    catch(error){
        res.status(500).json({message:"Failed to create a Note"});
    }
};

const getNotes= async(req,res)=>{
    try{
        const notes= await Note.find({
            user:req.userID,
            isArchived:false,
        }).sort({updatedAt:-1});

        res.status(200).json(notes);
    }
    catch(error){
        res.status(500).json({message: "Failed to fetch notes"});
    }
};

const updateNote= async(req,res)=>{
    try{
        const noteID=req.params.id;
        const {add,remove}=req.body;

        // --- VALIDATION (early exit) ---
        if (add && !Array.isArray(add)) {
            return res.status(400).json({ message: "`add` must be an array" });
        }

        if (remove && !Array.isArray(remove)) {
            return res.status(400).json({ message: "`remove` must be an array" });
        }

        if (add && add.some(tag => typeof tag !== "string")) {
            return res.status(400).json({ message: "All tags in `add` must be strings" });
        }

        if (remove && remove.some(tag => typeof tag !== "string")) {
            return res.status(400).json({ message: "All tags in `remove` must be strings" });
        }

        // UPDATE
        const note= await Note.findOne({
            _id:noteID,
            user: req.userID
        });

        if(!note){
            return res.status(404).json({message:"Note not found"});
        }

        note.title = req.body.title ?? note.title;
        note.content = req.body.content ?? note.content;
        note.isPinned = req.body.isPinned ?? note.isPinned;
    
        const updatedNote= await note.save();
        res.status(200).json(updatedNote)

    }
    catch(error){
        res.status(500).json({message:"Failed to Update Notes!"});
    }
}

const deleteNote= async(req,res)=>{
    try{
        const noteID=req.params.id;

        const note= await Note.findOneAndUpdate(
            {_id:noteID, user:req.userID},
            {isArchived:true},
            {new:true}
        );

        if(!note){
            return res.status(404).json({ message: "Note not found" });
        }

        res.status(200).json({message:"Note archived successfully"})
    }
    catch(error){
        res.status(500).json({message:"Faield to delete Note"});
    }
}

const assignFolder=async(req,res)=>{
    try{
        const noteID=req.params.id;
        const {folderId}=req.body;
        
        const note= await Note.findOne({
            _id:noteID,
            user:req.userID
        });

        if(!note){
            return res.status(404).json({message:"Note not found"});
        }

        if(folderId === null){
            note.folder=null;
        }
        else{
            const folder= await Folder.findOne({
                _id:folderId,
                user:req.userID,
                isArchived:false
            });

            if(!folder){
                return res.status(400).json({message:"Invalid folder"});
            }

            note.folder=folderId;
        }

        await note.save();
        res.status(200).json(note);
    }
    catch{
        res.status(500).json({message:"Failed to assign folder"});
    }
};

const updateTags = async(req,res)=>{
    try{
        const noteID=req.params.id;
        const {add=[],remove=[]}=req.body;

        // 🔒 STRICT VALIDATION (BEFORE ANY DB LOGIC)

        if (add !== undefined && !Array.isArray(add)) {
            return res.status(400).json({ message: "`add` must be an array" });
        }

        if (remove !== undefined && !Array.isArray(remove)) {
            return res.status(400).json({ message: "`remove` must be an array" });
        }

        if (Array.isArray(add) && add.some(tag => typeof tag !== "string")) {
            return res.status(400).json({ message: "All tags in `add` must be strings" });
        }

        if (Array.isArray(remove) && remove.some(tag => typeof tag !== "string")) {
            return res.status(400).json({ message: "All tags in `remove` must be strings" });
        }

        // Build update object
        const update={};

        if (add.length > 0) {
            update.$addToSet = {
                tags: { $each: add }
            };
        }

        if (remove.length > 0) {
            update.$pull = {
                tags: { $in: remove }
            };
        }

        // If nothing to update
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: "No tags to update" });
        }

        const note = await Note.findOneAndUpdate(
            { _id: noteID, user: req.userID },
            update,
            { new: true }
        );

        if(!note){
            return res.status(404).json({message:"Note not found"});
        }

        res.status(200).json(note);
    }
    catch(error){
        console.log(error)
        res.status(500).json({message:"Failed to update tags"});
    }
}

const getNotesByFolder= async(req,res)=>{
    try{
        const {folderId}=req.params;

        if (!mongoose.Types.ObjectId.isValid(folderId)) {
            return res.status(400).json({ message: "Invalid folder id" });
        }

        const filter={
            user: req.userID,
            isArchived:false,
            folder:folderId
        }

        const notes= await Note.find(filter).sort({updatedAt:-1});

        res.status(200).json(notes);
    }
    catch(error){
        res.status(500).json({message:"Failed to fetch notes by folder"});
    }
}

const getNotesByTag = async(req,res)=>{
    try{
        const {tag}=req.params;

        const notes= await Note.find({
            user: req.userID,
            isArchived:false,
            tags:tag
        }).sort({updatedAt:-1});
        res.status(200).json(notes);
    }

    catch(error){
        res.status(500).json({message:"Failed to fetch notes by Tag"});
    }
}

module.exports={
    createNote,
    getNotes,
    updateNote,
    deleteNote,
    assignFolder,
    updateTags,
    getNotesByFolder,
    getNotesByTag
};