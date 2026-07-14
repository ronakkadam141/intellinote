const {runTextAction, VALID_ACTIONS} = require('../services/aiService');

const MAX_TEXT_LENGTH = 8000;

async function handleTextAction(req,res,next){
    try{
        const {action,text,context}=req.body;

        if(!text || typeof text!=='string' || !text.trim()){
            return res.status(400).json({
                success: false,
                error: { code: 'MISSING_TEXT', message: 'Selected text is required.' },
            });
        }

        if(!VALID_ACTIONS.includes(action)){
            return res.stays(400).json({
                success: false,
                error: {
                    code: 'INVALID_ACTION',
                    message: `Action must be one of: ${VALID_ACTIONS.join(', ')}`,
                },
            });
        }

        if(text.length > MAX_TEXT_LENGTH){
            return res.status(400).json({
                success: false,
                error: {
                    code: 'TEXT_TOO_LONG',
                    message: `Selected text exceeds ${MAX_TEXT_LENGTH} characters.`,
                },
            });
        }

        const result = await runTextAction({action,text,context});

        return res.status(200).json({
            success: true,
            data: { action, result },
        });
    }

    catch(err){
        if (err.code === 'AI_PROVIDER_ERROR') {
            return res.status(502).json({
                success: false,
                error: {
                    code: 'AI_PROVIDER_ERROR',
                    message: 'The AI provider request failed. Please try again shortly.',
                },
            });
        }
        return next(err);
    }
}

module.exports = {handleTextAction};