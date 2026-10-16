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
import { isTimeout } from '../database/database.module';
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
    if (isTimeout(exception)) {
      // The write did not commit; the client retries it idempotently (BR-18).
      this.logger.warn(describeUnexpected(exception));
      return [
        HttpStatus.SERVICE_UNAVAILABLE,
        { error: { code: 'UNAVAILABLE', message: 'Database busy, retry' } },
      ];
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : exposedStatus(exception);
    if (status !== undefined) {
      const code = STATUS_CODES[status] ?? (status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL');
      return [status, { error: { code, message: code } }];
    }
    this.logger.error(describeUnexpected(exception));
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL', message: 'Internal error' } },
    ];
  }
}

/** body-parser throws http-errors (413 past the limit, 415 for an unknown encoding), not Nest's. */
function exposedStatus(exception: unknown): number | undefined {
  const { status, expose } = (exception ?? {}) as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' ? status : undefined;
}

/** Drizzle puts query parameters (tokens, amounts, notes) in its message; log only the cause. */
export function describeUnexpected(exception: unknown): string {
  if (exception instanceof DrizzleQueryError) {
    const cause = exception.cause as { code?: string; message?: string } | undefined;
    return `Query failed: ${cause?.code ?? 'unknown'} ${cause?.message ?? ''}`.trim();
  }
  return exception instanceof Error ? (exception.stack ?? exception.name) : 'Non-error thrown';
}
