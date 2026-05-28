const mongoose= require('mongoose');

const documentSchema= new mongoose.Schema(
    {
        title:{
            type:String,
            required: true,
            trim:true,
            maxlength:50,
            default:"untitled",
        },

        content:{
            type:Object,
            default:{},
        },

        workspaceID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"Workspace",
            required:true,
            index:true,
        },

        folderID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"Folder",
            index:true,
            default:null,
        },

        createdBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true,
        },

        lastEditedBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true,
        },

        isArchived:{
            type:Boolean,
            default:false,
        },

        isPinned:{
            type:Boolean,
            default:false,
        },

        tags:{
            type:[String],
            default:[],
        },

        yjsState:{
            type:Buffer,
            default:null,
        },

    },

    {
        timestamps:true,
    }
);

// filtering indexes
documentSchema.index({workspaceID:1,updatedAt:-1});
documentSchema.index({workspaceID:1,folderID:1});
documentSchema.index({tags:1});

const Document = mongoose.model("Document", documentSchema);

export default Document;