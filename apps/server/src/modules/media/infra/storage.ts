/** 存储键由服务器生成；不使用客户端文件名。文件本体已信封加密。 */
import { mkdir, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { AppError } from '../../../platform/index.js';
export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** 列出存储里的全部对象键（注销核验 scripts/verify-user-purged 用，T-080）。 */
  list?(): AsyncIterable<string>;
}
function checkedKey(key: string): string {
  if (!/^[0-9a-f-]{36}\.sealed$/.test(key)) throw new Error('存储键格式不正确');
  return key;
}
export class DiskStorage implements ObjectStorage {
  constructor(private readonly root: string) {}
  private path(key: string) {
    return resolve(this.root, checkedKey(key));
  }
  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.pending`;
    try {
      await writeFile(temp, body, { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.pending`, { force: true });
  }
  async *list(): AsyncIterable<string> {
    let names: string[];
    try {
      names = await readdir(resolve(this.root));
    } catch {
      return;
    }
    for (const name of names) if (name.endsWith('.sealed') || name.endsWith('.pending')) yield name;
  }
}
export class S3Storage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}
  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: checkedKey(key),
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: checkedKey(key) }),
    );
    if (!object.Body || (object.ContentLength ?? 0) > 11 * 1024 * 1024)
      throw new AppError('service_unavailable', '媒体存储暂时不可用');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 11 * 1024 * 1024) throw new AppError('service_unavailable', '媒体存储暂时不可用');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkedKey(key) }));
  }
  async *list(): AsyncIterable<string> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const item of page.Contents ?? []) if (item.Key) yield item.Key;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
