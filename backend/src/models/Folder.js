const mongoose= require('mongoose');

const folderschema= new mongoose.Schema(
    {
        title:{
            type:String,
            required:true,
            trim:true,
            minlength:1
        },
        user:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User",
            required:true
        },
        isArchived:{
            type:Boolean,
            default:false
        }
    },
    {
        timestamps:true
    }
);

// unique folder names per user
folderschema.index({user:1,title:1},{unique:true});

module.exports=mongoose.model("Folder",folderschema);