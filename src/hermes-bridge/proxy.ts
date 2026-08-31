import { timingSafeEqual } from "node:crypto";
import { createServer, request as createRequest, type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import { createConnection } from "node:net";

export interface HermesProxyOptions {
  backendHost: string;
  backendPort: number;
  token: string;
}

export function createHermesProxy(options: HermesProxyOptions): Server {
  const authority = `${options.backendHost}:${options.backendPort}`;
  const server = createServer((incoming, outgoing) => {
    if (!isPublicStatus(incoming) && !hasToken(incoming, options.token)) {
      outgoing.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
      outgoing.end('{"detail":"Unauthorized"}');
      return;
    }

    const upstream = createRequest({
      host: options.backendHost,
      port: options.backendPort,
      method: incoming.method,
      path: incoming.url,
      headers: rewriteHeaders(incoming.headers, authority),
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
      outgoing.end('{"detail":"Hermes backend is starting or unavailable."}');
    });
    incoming.pipe(upstream);
  });

  server.on("upgrade", (incoming, client, head) => {
    if (!hasToken(incoming, options.token)) {
      client.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }

    const backend = createConnection({ host: options.backendHost, port: options.backendPort });
    backend.once("connect", () => {
      const requestLine = `${incoming.method ?? "GET"} ${incoming.url ?? "/"} HTTP/${incoming.httpVersion}`;
      const lines = [requestLine];
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (!name || value === undefined || shouldRewrite(name)) continue;
        lines.push(`${name}: ${value}`);
      }
      lines.push(`Host: ${authority}`);
      if (incoming.headers.origin) lines.push(`Origin: http://${authority}`);
      backend.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) backend.write(head);
      client.pipe(backend).pipe(client);
    });
    backend.on("error", () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    client.on("error", () => backend.destroy());
  });

  return server;
}

function isPublicStatus(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false;
  try { return new URL(request.url ?? "/", "http://loopback").pathname === "/api/status"; }
  catch { return false; }
}

function hasToken(request: IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const sessionHeader = typeof request.headers["x-hermes-session-token"] === "string"
    ? request.headers["x-hermes-session-token"]
    : "";
  let query = "";
  try { query = new URL(request.url ?? "/", "http://loopback").searchParams.get("token") ?? ""; }
  catch { /* malformed URLs fail closed */ }
  return constantEqual(bearer, expected) || constantEqual(sessionHeader, expected) || constantEqual(query, expected);
}

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function rewriteHeaders(headers: IncomingHttpHeaders, authority: string): IncomingHttpHeaders {
  const rewritten: IncomingHttpHeaders = { ...headers, host: authority };
  delete rewritten["x-forwarded-host"];
  delete rewritten["x-forwarded-proto"];
  delete rewritten.forwarded;
  if (headers.origin) rewritten.origin = `http://${authority}`;
  return rewritten;
}

function shouldRewrite(name: string): boolean {
  return ["host", "origin", "forwarded", "x-forwarded-host", "x-forwarded-proto"].includes(name.toLowerCase());
}
