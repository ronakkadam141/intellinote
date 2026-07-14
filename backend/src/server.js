const dotenv = require('dotenv');
dotenv.configure()

const mongoose = require('mongoose')
const app = require('./app');

const PORT = process.env.port || 5000;
const MONGO_URI = process.env.MONGO_URI;

async function start(){
    if(!MONGO_URI){
        console.error('MONGO URI is not set. Abort')
        process.exit(1);
    }

    try{
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Connected');

        app.listen(PORT, ()=>{
            console.log(`Server running on port ${PORT}`);
        });
    }
    catch(err){
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    }
}