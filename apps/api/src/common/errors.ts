import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

/** Stable error codes. The web app maps each one to a localized message. */
export const ERROR_STATUS = {
  AUTH_REQUIRED: HttpStatus.UNAUTHORIZED,
  SESSION_REVOKED: HttpStatus.UNAUTHORIZED,
  CSRF_FAILED: HttpStatus.FORBIDDEN,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
} as const satisfies Record<string, HttpStatus>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), issue: z.string() })).optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: { path: string; issue: string }[],
  ) {
    super(message, ERROR_STATUS[code]);
  }
}
