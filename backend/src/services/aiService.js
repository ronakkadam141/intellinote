const geminiProvider = require('./aiProviders/geminiProvider');

const PROVIDERS = {
    gemini : geminiProvider,
};

const ACTION_PROMPTS = {
    summarize: (text) => `Summarize the following text concisely, preserving the key ideas:\n\n${text}`,
    explain: (text) => `Explain the following concept in simple, plain language suitable for a student encountering it for the first time:\n\n${text}`,
    improve: (text) => `Improve the clarity, grammar, and flow of the following text. Keep the original meaning and tone:\n\n${text}`,
    bullets: (text) => `Convert the following text into a concise bulleted list of key points:\n\n${text}`,
    quiz: (text) => `Generate 3-5 quiz questions with answers based on the following text. Format each as "Q: ... / A: ...":\n\n${text}`,
};

const VALID_ACTIONS= Object.keys(ACTION_PROMPTS);

const IMAGE_ACTION_PROMPTS={
    explainDiagram:() =>'Explain what this diagram shows, describing its structure and how the parts relate to each other.',
    summarizeImage:() =>'Summarize the key information shown in this image.',
    extractNotes:()=>'Extract the content of this image into clear, structured study notes.',
    identifyConcepts:()=>'Identify and briefly explain the key educational concepts shown in this image.',
}

const VALID_IMAGE_ACTIONS = Object.keys(IMAGE_ACTION_PROMPTS);

function getActiveProvider(){
    const providerName = process.env.AI_PROVIDER || 'gemini';
    const provider = PROVIDERS[providerName];

    if(!provider){
        const err = new Error(`Unknown AI_PROVIDER: ${providerName}`);
        err.code = 'AI_PROVIDER_ERROR';
        throw err;
    }

    return provider;
}

async function runTextAction({action,text,context}){
    const buildPrompt = ACTION_PROMPTS[action];

    if(!buildPrompt){
        const err = new Error(`Invalid action:${action}`);
        err.code = 'INVALID_ACTION';
        throw err;
    }

    const prompt =context? `${buildPrompt(text)}\n\nAdditional surrounding context (for reference only):\n${context}`: buildPrompt(text);

    const provide = getActiveProvider();
    return provider.generateText({prompt});
}

async function runImageAction({action,imageUrl}){
    const buildPrompt = IMAGE_ACTION_PROMPTS[action];

    if(!buildPrompt){
        const err = new Error(`Invalid action: ${action}`);
        err.code = 'INVALID_ACTION';
        throw err;
    }

    const provider = getActiveProvider();

    if(!provider.generateFromImage){
        const err = new Error('Active AI provider does not support image input.');
        err.code = 'AI_PROVIDER_ERROR';
        throw err;
    }

    return provider.generateFromImage({ prompt: buildPrompt(), imageUrl });

}
module.exports = {runTextAction, runImageAction,VALID_ACTIONS,VALID_IMAGE_ACTIONS};