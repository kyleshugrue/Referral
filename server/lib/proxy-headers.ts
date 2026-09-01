import type { Response } from "express";

const RESPONSE_HEADERS_RECALCULATED_BY_EXPRESS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
]);

export function copyProxyResponseHeaders(headers: Headers, response: Response): void {
  headers.forEach((value, key) => {
    if (RESPONSE_HEADERS_RECALCULATED_BY_EXPRESS.has(key.toLowerCase())) return;
    response.setHeader(key, value);
  });
}