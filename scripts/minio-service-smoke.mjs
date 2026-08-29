import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.MINIO_ENDPOINT;
const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;

if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "MINIO_ENDPOINT, MINIO_ROOT_USER and MINIO_ROOT_PASSWORD are required",
  );
}

async function waitUntilReady() {
  const readyUrl = new URL("/minio/health/ready", endpoint);
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(readyUrl);
      if (response.ok) return;
    } catch {
      // Service containers can take a few seconds to publish their port.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`MinIO did not become ready at ${readyUrl}`);
}

await waitUntilReady();

const client = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const bucket = `question-bank-ci-${Date.now()}`;
const key = "service-container-probe.txt";
const body = "knowledge-route-minio-service-container";

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
  );
  const downloaded = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if ((await downloaded.Body?.transformToString()) !== body) {
    throw new Error(
      "MinIO returned content different from the uploaded object",
    );
  }

  const anonymous = await fetch(
    `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`,
  );
  if (anonymous.status !== 403) {
    throw new Error(
      `MinIO bucket is not private; anonymous GET returned ${anonymous.status}`,
    );
  }

  let missingObjectRejected = false;
  try {
    await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: "missing-object.txt" }),
    );
  } catch (error) {
    missingObjectRejected = error?.$metadata?.httpStatusCode === 404;
  }
  if (!missingObjectRejected) {
    throw new Error("MinIO missing-object failure path was not observed");
  }

  console.log(
    JSON.stringify({
      status: "ok",
      bucket,
      objectRoundTrip: true,
      missing404: true,
      privateBucket403: true,
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
