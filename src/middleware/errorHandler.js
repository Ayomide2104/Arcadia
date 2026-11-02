function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    err.message = err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 5 MB or smaller.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'You can add up to 4 photos to a post.'
      : 'That upload could not be read.';
  }
  if (err.code === 11000) status = 409;
  if (process.env.NODE_ENV !== 'production') {
    console.error(`${req.method} ${req.path}: ${err.name || 'Error'} (HTTP ${status})`);
  } else if (status >= 500) {
    // In production, log server errors so they show up in Render's Logs tab.
    console.error(`${req.method} ${req.path}: ${err.name || 'Error'}: ${err.message || 'no message'} (HTTP ${status})`);
  }
  const message = err.code === 11000 ? 'A record with that value already exists' :
    status === 400 && err.name === 'ValidationError' ? 'Request validation failed' :
    status === 400 && err.name === 'CastError' ? 'Invalid request value' :
    status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({
    success: false,
    error: message
  });
}

module.exports = errorHandler;
