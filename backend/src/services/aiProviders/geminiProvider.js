const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function providerError(message){
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
        body:JSON/stringify({
            contents:[{parts :[{text:prompts}]}],
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

module.exports = {generateText};
