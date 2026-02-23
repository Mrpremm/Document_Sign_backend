/**
 * Format success response
 */
exports.formatSuccess = (data, message = 'Success', statusCode = 200) => {
  return {
    status: 'success',
    statusCode,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Format error response
 */
exports.formatError = (message, statusCode = 500, errors = null) => {
  const response = {
    status: 'error',
    statusCode,
    message,
    timestamp: new Date().toISOString(),
  };

  if (errors) {
    response.errors = errors;
  }

  return response;
};

/**
 * Format paginated response
 */
exports.formatPaginated = (data, page, limit, total, message = 'Success') => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    status: 'success',
    message,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    timestamp: new Date().toISOString(),
  };
};

/**
 * Format validation error
 */
exports.formatValidationError = (errors) => {
  return {
    status: 'fail',
    statusCode: 400,
    message: 'Validation failed',
    errors: errors.array ? errors.array() : errors,
    timestamp: new Date().toISOString(),
  };
};