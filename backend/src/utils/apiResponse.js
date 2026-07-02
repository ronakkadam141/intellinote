exports.sendSuccess = (res, statusCode, data) => {
  return res.status(statusCode).json({
    success: true,
    data
  });
};

exports.sendError = (res, statusCode, error) => {
  return res.status(statusCode).json({
    success: false,
    error
  });
};