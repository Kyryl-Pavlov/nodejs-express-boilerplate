export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost/api/v1";

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

let cachedAuthHeaders: Record<string, string> | undefined;

/** Registers once (idempotent — a second run just gets "already registered") and
 * returns a valid Bearer header, cached across calls. */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (cachedAuthHeaders) return cachedAuthHeaders;

  const creds = { email: "e2e-runner@ci-test.internal", password: "E2eRunner1!" };
  await apiFetch("/auth/register", { method: "POST", body: JSON.stringify(creds) });
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify(creds),
  });
  const body = (await res.json()) as { data: { access_token: string } };
  cachedAuthHeaders = { Authorization: `Bearer ${body.data.access_token}` };
  return cachedAuthHeaders;
}
