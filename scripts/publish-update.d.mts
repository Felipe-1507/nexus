export const MANIFEST_NAME: string;
export interface PublishedManifest {
  version: string;
  file: string;
  sha512: string;
  releasedAt: string;
}
export function sha512File(file: string): Promise<string>;
export function buildManifest(args: { version: string; installer: string; now?: Date }): Promise<PublishedManifest>;
export function publish(args: {
  installer: string;
  version: string;
  destDir: string;
  now?: Date;
}): Promise<PublishedManifest>;
