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

function getActiveProvider(){
    const providerName = process.env.AI_PROVIDER || 'gemini';
    const provider = PROVIDERS[providerName];

    if(!provider){
        const err = new Error(`Unknown AI_PROVIDER: ${providerName}`);
        err.code = 'AI_PROVIDER_ERROR';
        throw err;
    }
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

module.exports = {runTextAction, VALID_ACTIONS};