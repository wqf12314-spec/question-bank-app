import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const endpoint = process.env.MINIO_ENDPOINT || "http://127.0.0.1:9000";
const accessKeyId = process.env.MINIO_ROOT_USER || "minioadmin";
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD || "minioadmin";
const client = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const bucket = `etag-evidence-${Date.now()}`;
const key = "two-part.bin";
const parts = [
  Buffer.alloc(5 * 1024 * 1024, 0x41),
  Buffer.alloc(1024 * 1024, 0x42),
];

function md5(buffer, encoding = "hex") {
  return createHash("md5").update(buffer).digest(encoding);
}

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
  );
  const uploaded = [];
  for (const [index, body] of parts.entries()) {
    const result = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: created.UploadId,
        PartNumber: index + 1,
        Body: body,
      }),
    );
    uploaded.push({ ETag: result.ETag, PartNumber: index + 1 });
  }
  const completed = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: created.UploadId,
      MultipartUpload: { Parts: uploaded },
    }),
  );
  const wholeFileMd5 = md5(Buffer.concat(parts));
  const expectedMultipartEtag = `${md5(
    Buffer.concat(parts.map((part) => md5(part, "buffer"))),
  )}-${parts.length}`;
  const actualEtag = completed.ETag?.replaceAll('"', "");

  if (actualEtag !== expectedMultipartEtag) {
    throw new Error(
      `unexpected multipart ETag: ${actualEtag} != ${expectedMultipartEtag}`,
    );
  }
  if (actualEtag === wholeFileMd5) {
    throw new Error("multipart ETag was incorrectly treated as whole-file MD5");
  }
  console.log(
    JSON.stringify({
      status: "ok",
      endpoint,
      partCount: parts.length,
      wholeFileMd5,
      multipartEtag: actualEtag,
      expectedMultipartEtag,
      differsFromWholeFileMd5: true,
    }),
  );
} finally {
  await client
    .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    .catch(() => undefined);
  await client
    .send(new DeleteBucketCommand({ Bucket: bucket }))
    .catch(() => undefined);
  client.destroy();
}
