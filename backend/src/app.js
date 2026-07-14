const express = require("express");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");

const aiRoutes = require('./routes/ai');
const authRoutes=require('./routes/auth');
const documentRoutes=require('./routes/documents')
const folderRoutes=require('./routes/folders')
const memberRoutes=require('./routes/member');
const workspaceRoutes=require('./routes/workspace');

const app = express();

app.use(cors());
app.use(express.json());

console.log("Index.js loaded");

// check backend
app.get("/", (req, res) => {
  res.send("Backend root working");
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspaces/:workspaceId/members", memberRoutes);
app.use("/api/workspaces/:workspaceId/folders",folderRoutes);
app.use("/api/workspaces/:workspaceId/documents",documentRoutes);
app.use('/api/workspaces/:workspaceId/ai', aiRoutes);

// error handler 
app.use(errorHandler);

module.exports=app
/*
Folder info    
"title": "First Folder",
    "user": "694e72c349ca561bce55ca46",
    "isArchived": false,
    "_id": "694e73a6b01a519689943d1a",
    "createdAt": "2025-12-26T11:38:14.899Z",
    "updatedAt": "2025-12-26T11:38:14.899Z",
    "__v": 0

Note
{
    "title": "Finish backend",
    "content": "Complete filtering APIs",
    "user": "694e72c349ca561bce55ca46",
    "folder": null,
    "tags": [],
    "isArchived": false,
    "isPinned": false,
    "_id": "694e73fbb01a519689943d1c",
    "createdAt": "2025-12-26T11:39:39.949Z",
    "updatedAt": "2025-12-26T11:39:39.949Z",
    "__v": 0
}

http://localhost:5000/notes/694e73fbb01a519689943d1c/tags
*/