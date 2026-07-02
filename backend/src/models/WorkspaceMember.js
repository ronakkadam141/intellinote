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

// getMyWorkspaces query
WorkspaceMemberSchema.index({ userId: 1 });

// countDocuments in getWorkspaceById
WorkspaceMemberSchema.index({ workspaceId: 1 });

// duplicate guard
WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const WorkspaceMember = mongoose.model(
    "WorkspaceMember", workspaceMemberSchema
);

export default workspaceMember;