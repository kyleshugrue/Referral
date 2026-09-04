const PRIVATE_ORIGIN_ERROR = 'Outbound URL is not an allowed public service';

export function validateAllowedOutboundUrl(
  value: string,
  allowedOrigins: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(PRIVATE_ORIGIN_ERROR);
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !allowedOrigins.includes(url.origin)
  ) {
    throw new Error(PRIVATE_ORIGIN_ERROR);
  }

  return url;
}

export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Outbound response too large');
  }

  const body = await response.text();
  if (body.length > maxBytes) {
    throw new Error('Outbound response too large');
  }
  return body;
}