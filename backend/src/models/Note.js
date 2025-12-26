const mongoose= require('mongoose');

const noteSchema= new mongoose.Schema(
    {
        title:{
            type:String,
            required: true,
            trim:true,
            maxlength:50
        },

        content:{
            type:String,
            default:""
        },

        user: {
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true,
            index:true
        },

        folder: {
            type:mongoose.Schema.Types.ObjectId,
            ref:"Folder",
            default:null
        },
        
        tags:{
            type:[String],
            default:[]
        },

        isArchived:{
            type:Boolean,
            default:false
        },

        isPinned:{
            type:Boolean,
            default:false
        }
    },

    {
        timestamps:true
    }
);

// filtering indexes
noteSchema.index({user:1,folder:1});
noteSchema.index({user:1,tags:1});

module.exports = mongoose.model("Note",noteSchema)