const mongoose= require('mongoose')

const workspaceSchema=new mongoose.Schema(
    {
        name:{
            type:String,
            required:true,
            trim:true,
            maxlength:100,

        },

        description:{
            type:String,
            trim:true,
            maxlength:500,
            default:"",
        },

        slug:{
            type:String,
            required:true,
            unique:true,
            lowercase:true,
            trim:true,
            index:true,
        },

        ownerID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true,
            index:true,
        },

        isArchived:{
            type:Boolean,
            default:false
        },

    },

    {
        timestamps: true,
    }
)

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;