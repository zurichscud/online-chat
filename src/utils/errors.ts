/** 业务错误基类：携带 HTTP 状态码、错误码，并决定是否向客户端暴露原始信息。 */
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

/** 请求参数或消息格式不合法（400）。 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/** 身份验证失败或令牌失效（401）。 */
export class UnauthorizedError extends AppError {
  constructor(message = '身份验证失败。') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/** 请求的资源不存在（404）。 */
export class NotFoundError extends AppError {
  constructor(message = '资源不存在。') {
    super(message, 404, 'NOT_FOUND');
  }
}

/** 资源状态冲突，例如重复创建或保存不存在的会话（409）。 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/** 请求过于频繁或被限流（429）。 */
export class TooManyRequestsError extends AppError {
  constructor(message = '操作太频繁，请稍后再试。') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}
