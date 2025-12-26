const express = require("express");
const mongoose=require('mongoose');
const cors = require("cors");
const dotenv = require('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

console.log("Index.js loaded");

// check backend
app.get("/", (req, res) => {
  res.send("Backend root working");
});

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/notes", require("./routes/notes"));
app.use("/ai", require("./routes/ai"));
app.use("/folder",require("./routes/folder"));

// mongodb connection 
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err))

// start server
const PORT=process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("Server running on 5000");
});


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

*/