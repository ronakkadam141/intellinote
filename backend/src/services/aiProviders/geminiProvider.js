const env = require('../../config/env');

const GEMINI_MODEL = env.GEMINI_MODEL;
const GEMINI_API_KEY =env.GEMINI_API_KEY;

function providerError(message){
    console.error('[Gemini Provider Error]', message);
    const err =new Error(message);
    err.code ='AI_PROVIDER_ERROR';
    return err;
}

async function generateText({prompt}){
    if(!GEMINI_API_KEY){
        throw providerError('GEMINI_API_KEY not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url,{
        method:'POST',
        headers:{'Content-type': 'application/json'},
        body:JSON.stringify({
            contents:[{parts :[{text:prompt}]}],
        }),
    });

    if(!response.ok){
        throw providerError(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw providerError('Gemini returned an empty response.');
    }

    return text.trim();

}

async function generateFromImage({prompt, imageUrl}){
    if(!GEMINI_API_KEY){
        throw providerError("GEMINI_API_KEY is not configured");
    }

    const imageResponse = await fetch(imageUrl);
    if(!imageResponse.ok){
        throw providerError(`Could not fetch image from imageUrl : ${imageResponse.url}`);
    }

    const mimeType = imageResponse.headers.get('content-type') || 'image/jpg';
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url,{
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: mimeType, data: base64Data } },
                    ],
                },
            ],
        }),
    });

    if(!response.ok){

        throw providerError(`Gemini API error ; ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
        throw providerError('Gemini returned an empty response.');
    }

    return text.trim();
}
module.exports = {generateText,generateFromImage};
