export const API_RESPONSE_CONTRACT_VERSION = "2026-09-29";

export type ApiResponseMeta = {
  requestId?: string;
  contractVersion?: string;
  [key: string]: unknown;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
  meta: Required<Pick<ApiResponseMeta, "contractVersion">> & ApiResponseMeta;
};

export type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: Required<Pick<ApiResponseMeta, "contractVersion">> & ApiResponseMeta;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function withContractVersion(meta: ApiResponseMeta = {}) {
  return {
    ...meta,
    contractVersion: meta.contractVersion ?? API_RESPONSE_CONTRACT_VERSION,
  };
}

export function successResponse<T>(data: T, meta?: ApiResponseMeta): ApiSuccessResponse<T> {
  return {
    ok: true,
    data,
    meta: withContractVersion(meta),
  };
}

export function errorResponse(
  code: string,
  message: string,
  details?: unknown,
  meta?: ApiResponseMeta,
): ApiErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    meta: withContractVersion(meta),
  };
}

export function validateApiResponseContract(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null) {
    return ["response must be an object"];
  }

  const response = value as Record<string, unknown>;
  if (typeof response.ok !== "boolean") {
    errors.push("ok must be a boolean");
  }

  const meta = response.meta as Record<string, unknown> | undefined;
  if (typeof meta !== "object" || meta === null) {
    errors.push("meta must be an object");
  } else if (typeof meta.contractVersion !== "string" || meta.contractVersion.length === 0) {
    errors.push("meta.contractVersion must be a non-empty string");
  }

  if (response.ok === true && !("data" in response)) {
    errors.push("success responses must include data");
  }

  if (response.ok === false) {
    const error = response.error as Record<string, unknown> | undefined;
    if (typeof error !== "object" || error === null) {
      errors.push("error responses must include an error object");
    } else {
      if (typeof error.code !== "string" || error.code.length === 0) {
        errors.push("error.code must be a non-empty string");
      }
      if (typeof error.message !== "string" || error.message.length === 0) {
        errors.push("error.message must be a non-empty string");
      }
    }
  }

  return errors;
}
