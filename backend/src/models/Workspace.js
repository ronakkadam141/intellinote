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
        },

        ownerId:{
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

workspaceSchema.index({ slug: 1 }, { unique: true });   // slug uniqueness
workspaceSchema.index({ ownerId: 1 });                  // future: "workspaces I own" queries
const Workspace = mongoose.model("Workspace", workspaceSchema);

module.exports=Workspace;