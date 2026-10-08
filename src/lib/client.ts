export class RequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: options?.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options?.signal,
    ...(options?.body !== undefined
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RequestError(
      data.error?.message ?? "אירעה שגיאה. נסו שוב",
      data.error?.code ?? "UNKNOWN",
      response.status,
    );
  return data;
}
export const messageOf = (error: unknown) =>
  error instanceof RequestError
    ? error.message
    : "לא הצלחנו להשלים את הפעולה. בדקו את החיבור ונסו שוב";
