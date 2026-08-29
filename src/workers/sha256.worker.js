// v2 包将 SHA-256 放在 sha2.js；显式扩展名也能让 Vite 的 Worker 打包器稳定解析。
import { sha256 } from "@noble/hashes/sha2.js";

self.onmessage = async ({ data }) => {
  const { file, chunkSize } = data;
  const hash = sha256.create();
  const total = Math.max(1, Math.ceil(file.size / chunkSize));

  for (let index = 0; index < total; index += 1) {
    const start = index * chunkSize;
    const chunk = await file
      .slice(start, Math.min(start + chunkSize, file.size))
      .arrayBuffer();
    hash.update(new Uint8Array(chunk));
    self.postMessage({ type: "progress", completed: index + 1, total });
  }

  self.postMessage({
    type: "done",
    digest: Array.from(hash.digest(), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  });
};
