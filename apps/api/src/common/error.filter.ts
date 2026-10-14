import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { DrizzleQueryError } from 'drizzle-orm';
import { ZodError } from 'zod';
import { ApiError, type ErrorBody, type ErrorCode } from './errors';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: 'AUTH_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'UNAVAILABLE',
};

/** Renders every error as `{ error: { code, message } }` and never echoes request data. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toBody(exception);
    response.status(status).json(body);
  }

  private toBody(exception: unknown): [number, ErrorBody] {
    if (exception instanceof ApiError) {
      return [
        exception.getStatus(),
        { error: { code: exception.code, message: exception.message, details: exception.details } },
      ];
    }
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const details =
        zodError instanceof ZodError
          ? zodError.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.code }))
          : undefined;
      return [
        HttpStatus.BAD_REQUEST,
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid request', details } },
      ];
    }
    if (exception instanceof ZodSerializationException) {
      this.logger.error('Response failed its schema');
      return [
        HttpStatus.INTERNAL_SERVER_ERROR,
        { error: { code: 'INTERNAL', message: 'Internal error' } },
      ];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODES[status] ?? 'INTERNAL';
      return [status, { error: { code, message: code } }];
    }
    this.logger.error(describeUnexpected(exception));
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL', message: 'Internal error' } },
    ];
  }
}

/** Drizzle puts query parameters (tokens, amounts, notes) in its message; log only the cause. */
function describeUnexpected(exception: unknown): string {
  if (exception instanceof DrizzleQueryError) {
    const cause = exception.cause as { code?: string; message?: string } | undefined;
    return `Query failed: ${cause?.code ?? 'unknown'} ${cause?.message ?? ''}`.trim();
  }
  return exception instanceof Error ? (exception.stack ?? exception.name) : 'Non-error thrown';
}
