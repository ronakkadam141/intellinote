const {validationResult} = require('express-validator');

function validate(req,res,next){
    const errors = validationResult(req);

    if(!errors.isEmpty()){
        return res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed.',
                details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
            },
        });
    }

    next();
}

module.exports=validate;