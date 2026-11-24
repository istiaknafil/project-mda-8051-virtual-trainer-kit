import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { execFile } from "node:child_process";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 8051);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
try {
  await stat(resolve(root, "index.html"));
} catch {
  console.error("Build not found. Run npm.cmd ci, then npm.cmd run build.");
  process.exit(1);
}
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(
    `MDA-8051 Virtual Laboratory\n${url}\nOffline local server. Press Ctrl+C to stop.`,
  );
  if (process.argv.includes("--open") && process.platform === "win32")
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
});
