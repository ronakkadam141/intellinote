const mongoose= require('mongoose');

const documentSchema= new mongoose.Schema(
    {
        title:{
            type:String,
            required: true,
            trim:true,
            maxlength:200,
            default:'Untitled',
        },

        content:{
            type:mongoose.Schema.Types.Mixed,
            default:()=>({type:'doc',content:[]}),
        },

        workspaceId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Workspace',
            required:true,
            index:true,
        },

        folderId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Folder',
            index:true,
            default:null,
        },

        createdBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'User',
            required:true,
        },

        lastEditedBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'User',
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
        
        images :{
            type:[
                {
                    url: { type: String, required: true },
                    publicId: { type: String, required: true },
                    width: Number,
                    height: Number,
                    format: String,
                    uploadedAt: { type: Date, default: Date.now },                    
                },
            ],
            default:[],
        },
        
        yjsState:{
            type:Buffer,
            default:null,
            select:false,
        },
    },

    {
        timestamps:true,
    }
);

// filtering indexes
documentSchema.index({workspaceId:1,isArchived:1});
documentSchema.index({workspaceId:1,folderId:1});
documentSchema.index({workspaceId:1,tags:1});
documentSchema.index({workspaceId:1,isPinned:-1,updatedAt:-1});

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;