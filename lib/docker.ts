import http from "node:http";

const DOCKER_SOCKET = "/var/run/docker.sock";

function dockerRequest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export async function listContainers(): Promise<DockerContainer[]> {
  const raw = await dockerRequest("/v1.43/containers/json?all=true");
  const containers = JSON.parse(raw) as Array<{
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
  }>;
  return containers.map((c) => ({
    id: c.Id.slice(0, 12),
    name: c.Names[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
  }));
}

export async function getContainerLogs(
  containerId: string,
  tail: number = 200
): Promise<string> {
  const raw = await dockerRequest(
    `/v1.43/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`
  );
  // Docker multiplexed stream: each frame has 8-byte header
  // For TTY containers, it's raw text. Clean up control chars either way.
  const lines: string[] = [];
  let i = 0;
  const buf = Buffer.from(raw, "binary");
  while (i < buf.length) {
    // Check if this looks like a multiplexed stream header
    const streamType = buf[i];
    if ((streamType === 0 || streamType === 1 || streamType === 2) && buf.length >= i + 8) {
      const frameSize = buf.readUInt32BE(i + 4);
      if (frameSize > 0 && frameSize < 1024 * 1024 && i + 8 + frameSize <= buf.length) {
        const line = buf.subarray(i + 8, i + 8 + frameSize).toString("utf-8");
        lines.push(line);
        i += 8 + frameSize;
        continue;
      }
    }
    // Fallback: treat rest as raw text
    lines.push(buf.subarray(i).toString("utf-8"));
    break;
  }
  return lines.join("");
}

export function isDockerAvailable(): boolean {
  try {
    const fs = require("fs");
    fs.accessSync(DOCKER_SOCKET);
    return true;
  } catch {
    return false;
  }
}
