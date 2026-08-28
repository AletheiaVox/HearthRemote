import http from "node:http";
import https from "node:https";

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export async function requestHermesJson<T>(webSocketEndpoint: string, token: string, path: string): Promise<T> {
  const endpoint = new URL(webSocketEndpoint);
  const url = new URL(path, `${endpoint.protocol === "wss:" ? "https:" : "http:"}//${endpoint.host}`);
  const secure = url.protocol === "https:";
  const transport = secure ? https : http;

  return new Promise<T>((resolve, reject) => {
    const request = transport.request(url, {
      headers: {
        Host: `127.0.0.1:${endpoint.port || (secure ? "443" : "80")}`,
        "X-Hermes-Session-Token": token,
      },
      ...(secure ? { servername: endpoint.hostname } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("Hermes returned an unexpectedly large response."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Hermes request failed (${response.statusCode ?? "unknown"}): ${safeErrorText(body)}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error("Hermes returned an invalid JSON response."));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => request.destroy(new Error("Hermes request timed out.")));
    request.end();
  });
}

function safeErrorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: { message?: unknown }; message?: unknown };
    const value = parsed.detail ?? parsed.error?.message ?? parsed.message;
    return typeof value === "string" ? value.slice(0, 300) : "unknown error";
  } catch {
    return "unknown error";
  }
}
