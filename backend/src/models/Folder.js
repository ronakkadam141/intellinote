const mongoose= require('mongoose');

const folderschema= new mongoose.Schema(
    {
        name:{
            type:String,
            required:true,
            trim:true,
            maxlength:50,
        },

        workspaceID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"Workspace",
            required:true,
            index:true,
        },

        createdBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true,
        },

        isArchived:{
            type:Boolean,
            default:false,
        },

    },
    
    {
        timestamps:true,
    }
);

// unique folder names per user
folderschema.index({workspaceID:1,name:1},{unique:true});

const Folder = mongoose.model("Folder", folderSchema);

export default Folder;