import { logger } from "../utils/logger.js";

class ErrorHandler extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  export const errorMiddleware = (err, req, res, next) => {
    err.message = err.message || "Internal Server Error";
    err.statusCode = err.statusCode || 500;

    if (err.name === "CastError") {
      const message = `Resource not found. Invalid: ${err.path}`;
      err = new ErrorHandler(message, 400);
    }


    if (err.name === 'ValidationError') {
      const validationErrors = Object.values(err.errors).map(e => e.message);
      return next(new ErrorHandler(validationErrors.join(', '), 400));
    }

    if (err.name === "MulterError") {
      err.statusCode = 400;
      err.message = err.code === "LIMIT_FILE_SIZE" ? "Uploaded image is too large" : err.message;
    }

    logger.error("unhandled_error", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: err.statusCode,
      message: err.message,
      stack: err.stack,
    });

    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      requestId: req.requestId,
    });
  };

  export default ErrorHandler;
