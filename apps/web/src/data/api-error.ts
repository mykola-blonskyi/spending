export const API_ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_REVOKED',
  'CSRF_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNAVAILABLE',
  'INTERNAL',
  'NETWORK',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorDetail {
  readonly path: string;
  readonly issue: string;
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: readonly ApiErrorDetail[];
  /** True when the code came from the API's error envelope rather than being inferred from the status. */
  readonly fromEnvelope: boolean;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: readonly ApiErrorDetail[];
    fromEnvelope?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fromEnvelope = init.fromEnvelope ?? false;
    if (init.details) this.details = init.details;
  }
}

function codeFromStatus(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 400:
    case 422:
      return 'VALIDATION_FAILED';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    case 502:
    case 503:
    case 504:
      return 'UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details: ApiErrorDetail[] = [];
  for (const item of value as unknown[]) {
    if (isRecord(item) && typeof item['path'] === 'string' && typeof item['issue'] === 'string') {
      details.push({ path: item['path'], issue: item['issue'] });
    }
  }
  return details.length > 0 ? details : undefined;
}

export function parseApiError(status: number, body: unknown): ApiError {
  const envelope = isRecord(body) ? body['error'] : undefined;
  if (isRecord(envelope) && isApiErrorCode(envelope['code'])) {
    const message = typeof envelope['message'] === 'string' ? envelope['message'] : '';
    const details = parseDetails(envelope['details']);
    return new ApiError({
      status,
      code: envelope['code'],
      message: message || envelope['code'],
      fromEnvelope: true,
      ...(details && { details }),
    });
  }
  const code = codeFromStatus(status);
  return new ApiError({ status, code, message: `Request failed with status ${status}` });
}

export function errorCode(error: unknown): ApiErrorCode {
  return error instanceof ApiError ? error.code : 'INTERNAL';
}
