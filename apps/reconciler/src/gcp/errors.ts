/**
 * Typed error classes for the reconciler's GCP Certificate Manager calls.
 *
 * We translate google-gax's numeric gRPC status codes into domain errors so
 * call sites can branch via `instanceof` instead of inspecting anonymous
 * error objects. The mapping follows the standard gRPC status enum:
 *
 *   5 = NOT_FOUND
 *   6 = ALREADY_EXISTS
 *   7 = PERMISSION_DENIED
 *
 * See https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
 *
 * R5 Decision 6 treats `ALREADY_EXISTS` as an explicit success path: on
 * CREATE it means a prior run already built the resource (lease-expiry
 * mid-operation window). The reconciler re-GETs and verifies the spec.
 */

export const GRPC_STATUS_NOT_FOUND = 5;
export const GRPC_STATUS_ALREADY_EXISTS = 6;
export const GRPC_STATUS_PERMISSION_DENIED = 7;

/**
 * Shape of a google-gax error. We intentionally type it as a loose record
 * and narrow via `hasCode`, because google-gax ships `any`-typed errors
 * and this project's lint rules forbid `any`.
 */
interface GaxLikeError {
  code?: number;
  message?: string;
  details?: string;
}

function isGaxLikeError(err: unknown): err is GaxLikeError {
  return typeof err === "object" && err !== null;
}

export class NotFoundError extends Error {
  constructor(
    public readonly resourceKind: string,
    public readonly resourceName: string,
    cause?: unknown,
  ) {
    super(`GCP ${resourceKind} not found: ${resourceName}`);
    this.name = "NotFoundError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class AlreadyExistsError extends Error {
  constructor(
    public readonly resourceKind: string,
    public readonly resourceName: string,
    cause?: unknown,
  ) {
    super(`GCP ${resourceKind} already exists: ${resourceName}`);
    this.name = "AlreadyExistsError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly resourceKind: string,
    public readonly resourceName: string,
    cause?: unknown,
  ) {
    super(`GCP ${resourceKind} permission denied: ${resourceName}`);
    this.name = "PermissionDeniedError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Wraps a promise-returning GCP call. On rejection, translates known
 * gRPC status codes to our domain errors; unknown errors are rethrown.
 */
export async function mapGcpError<T>(
  resourceKind: string,
  resourceName: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isGaxLikeError(err) && typeof err.code === "number") {
      if (err.code === GRPC_STATUS_NOT_FOUND) {
        throw new NotFoundError(resourceKind, resourceName, err);
      }
      if (err.code === GRPC_STATUS_ALREADY_EXISTS) {
        throw new AlreadyExistsError(resourceKind, resourceName, err);
      }
      if (err.code === GRPC_STATUS_PERMISSION_DENIED) {
        throw new PermissionDeniedError(resourceKind, resourceName, err);
      }
    }
    throw err;
  }
}
