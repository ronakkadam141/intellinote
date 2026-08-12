const http = require('http');
const app = require('./app');
const mongoose = require('mongoose');

const env = require('./config/env');
const { initYjsServer } = require('./lib/yjsServer');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
async function start(){
    try{
        await mongoose.connect(env.MONGO_URI);
        console.log('MongoDB Connected');

        const server = http.createServer(app);
        initYjsServer(server);

        server.listen(env.PORT, ()=>{
            console.log(`Server running on port ${env.PORT}`);
        });
    }
    catch(err){
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    }
}
start()