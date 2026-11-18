import { z } from 'zod';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'} });
}

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues.map(issue => `${issue.path.join('.') || 'Input'}: ${issue.message}`).join('; '));
  return result.data;
}

export async function readBody(request: Request, limit: number): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Use application/json.');
  }
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request body is required.');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      body += decoder.decode(value, {stream: true});
    }
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Request must contain valid UTF-8 JSON.');
  } finally {
    reader.releaseLock();
  }
}
