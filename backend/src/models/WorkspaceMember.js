const mongoose= require('mongoose');

const workspaceMemberSchema = new mongoose.Schema(
    {
        workspaceID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"Workspace",
            index:true,
            required:true,
        },

        userID:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            index:true,
            required:true,
        },

        role:{
            type:String,
            enum:["owner","editor","viewer"],
            required:true,
            default:"viewer",
        },

        joinedAt:{
            type:Date,
            default:Date.now,
        },

        invitedBy:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            default:null,
        },
    },

    {
        timestamps:true,
    }
);

workspaceMemberSchema.index(
    {workspaceID:1,userID:1},
    {unique:true}
);

const WorkspaceMember = mongoose.model(
    "WorkspaceMember", workspaceMemberSchema
);

export default workspaceMember;