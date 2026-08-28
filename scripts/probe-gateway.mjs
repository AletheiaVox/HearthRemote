import WebSocket from "ws";

const origin = process.env.HEARTH_GATEWAY_PROBE_ORIGIN || "http://127.0.0.1:4521";
const code = process.env.HEARTH_GATEWAY_PAIRING_CODE;
if (!code) throw new Error("Set HEARTH_GATEWAY_PAIRING_CODE before running the gateway probe.");

const bootstrap = await jsonFetch("/api/bootstrap");
if (bootstrap.paired !== false) throw new Error("A fresh browser was unexpectedly paired.");

const pairResponse = await fetch(`${origin}/api/auth/pair`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ code, label: "Automated gateway probe" }),
});
if (!pairResponse.ok) throw new Error(`Pairing failed: ${pairResponse.status} ${await pairResponse.text()}`);
const cookie = pairResponse.headers.get("set-cookie")?.split(";")[0];
if (!cookie?.startsWith("hearth_session=")) throw new Error("Pairing did not issue a Hearth session cookie.");

const snapshot = await jsonFetch("/api/snapshot", { headers: { Cookie: cookie } });
if (!snapshot.webClient?.paired || !snapshot.webClient?.host) {
  throw new Error("The authenticated snapshot was missing its web-client boundary.");
}

const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
const manifest = await manifestResponse.json();
if (manifest.display !== "standalone" || manifest.name !== "Hearth Remote") {
  throw new Error("The installable web manifest has an invalid shape.");
}

const wsOrigin = origin.replace(/^http/, "ws");
const socket = new WebSocket(`${wsOrigin}/api/client`, { headers: { Cookie: cookie, Origin: origin } });
const firstFrame = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Gateway WebSocket timed out.")), 10_000);
  socket.once("message", (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); });
  socket.once("error", reject);
});
if (firstFrame.type !== "snapshot" || !firstFrame.snapshot?.webClient?.paired) {
  throw new Error("Gateway WebSocket did not begin with an authenticated snapshot.");
}

if (process.env.HEARTH_GATEWAY_LIVE_PROBE === "1") {
  const hermesSnapshotPromise = waitForSnapshot(socket, (value) =>
    value.provider === "hermes"
      && value.connection === "ready"
      && Array.isArray(value.hermesProfiles)
      && value.hermesProfiles.length > 0
      && Array.isArray(value.sessions),
  );
  await invoke(socket, "selectProvider", ["hermes"]);
  const hermesSnapshot = await hermesSnapshotPromise;
  console.log(`Live provider probe reached Hermes with ${hermesSnapshot.hermesProfiles.length} profiles and ${hermesSnapshot.sessions.length} sessions.`);
  await invoke(socket, "disconnect", []);
}
socket.close();

const logout = await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: origin } });
if (!logout.ok) throw new Error(`Logout failed: ${logout.status}`);
const afterLogout = await jsonFetch("/api/bootstrap", { headers: { Cookie: cookie } });
if (afterLogout.paired !== false) throw new Error("The gateway session was not revoked by logout.");

console.log("Hearth Gateway probe passed: pairing, HttpOnly session, authenticated snapshot, WebSocket, PWA manifest, and revocation.");

async function jsonFetch(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function invoke(socket, method, params) {
  const id = `${method}-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`${method} timed out.`));
    }, 20_000);
    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.id !== id) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      if (frame.error) reject(new Error(`${method} failed: ${frame.error.message}`));
      else resolve(frame.result);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitForSnapshot(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("The expected live provider snapshot did not arrive."));
    }, 20_000);
    const onMessage = (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type !== "snapshot" || !predicate(frame.snapshot)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(frame.snapshot);
    };
    socket.on("message", onMessage);
  });
}
