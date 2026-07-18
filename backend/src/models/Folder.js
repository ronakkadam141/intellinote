const mongoose= require('mongoose');

const folderSchema= new mongoose.Schema(
    {
        name:{
            type:String,
            required:true,
            trim:true,
            maxlength:100,
        },

        workspaceId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Workspace',
            required:true,
        },

        createdBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'User',
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

// unique folder names per workspace
folderSchema.index({workspaceId:1,name:1},{unique:true});

const Folder = mongoose.model('Folder', folderSchema);

module.exports = Folder;