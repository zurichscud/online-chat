export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = 'INTERNAL_ERROR',
    public readonly expose = statusCode < 500
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '身份验证失败。') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在。') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = '操作太频繁，请稍后再试。') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}
