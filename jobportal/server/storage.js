import { randomUUID } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getStorageClient() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    const error = new Error('Private file storage is not configured.')
    error.status = 503
    throw error
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })
  return { client, bucket: R2_BUCKET }
}

export async function savePrivateFile(file, prefix) {
  const { client, bucket } = getStorageClient()
  const extension = file.mimetype === 'application/pdf' ? '.pdf' : '.docx'
  const key = `${prefix}/${randomUUID()}${extension}`
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentLength: file.size,
    ContentType: file.mimetype,
    Metadata: { originalname: encodeURIComponent(file.originalname.slice(0, 180)) },
  }))
  return key
}

export async function getPrivateFileUrl(key) {
  const { client, bucket } = getStorageClient()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 })
}
