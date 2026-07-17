const dotenv = require('dotenv');
dotenv.config();

const REQUIRED_VARS= [
    'JWT_SECRET',
    'MONGO_URI',
    'GEMINI_API_KEY',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
];

function validateEnv(){
    const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');

    if(missing.length>0){
       console.error('Missing required environment variables:');
        missing.forEach((key) => console.error(`   - ${key}`));
        console.error('\nCheck your .env file against .env.example and try again.');
        process.exit(1); 
    }
}

validateEnv();

module.exports = {
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    MONGO_URI: process.env.MONGO_URI,
    PORT: process.env.PORT || 5000,
    
    AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
}