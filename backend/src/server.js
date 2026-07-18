const app = require('./app');
const mongoose = require('mongoose');

const env=require('./config/env');


async function start(){
    try{
        await mongoose.connect(env.MONGO_URI);
        console.log('MongoDB Connected');

        app.listen(env.PORT, ()=>{
            console.log(`Server running on port ${env.PORT}`);
        });
    }
    catch(err){
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    }
}
start()