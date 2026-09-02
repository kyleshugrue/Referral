import { firebaseStorage } from '../lib/firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { logger } from '../lib/logger';
import { UPLOAD_LIMITS } from '../lib/upload-validation';
const execFileAsync = promisify(execFile);

const MANAGED_MEDIA_PREFIXES = [
  'profile-pictures/',
  'resumes/',
  'resume-previews/',
  'legacy/',
] as const;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;
const MAX_MEDIA_ID_LENGTH = 512;

export function isManagedMediaObjectKey(fileName: string): boolean {
  return MANAGED_MEDIA_PREFIXES.some((prefix) => fileName.startsWith(prefix))
    && !fileName.includes('..')
    && !fileName.startsWith('/')
    && !fileName.includes('\\')
    && !fileName.includes('\0');
}

export interface UploadResult {
  url: string;
  fileName: string;
}

export interface ResumeUploadResult {
  url: string;
  fileName: string;
  previewUrls?: string[];
}

export class FirebaseStorageService {
  private bucket = firebaseStorage?.bucket();

  private isAllowedObjectKey(fileName: string): boolean {
    return isManagedMediaObjectKey(fileName);
  }

  private toMediaId(fileName: string): string {
    if (!this.isAllowedObjectKey(fileName)) {
      throw new Error('Invalid managed media object key');
    }
    return Buffer.from(fileName, 'utf8').toString('base64url');
  }

  private fromMediaId(mediaId: string): string {
    if (
      mediaId.length === 0 ||
      mediaId.length > MAX_MEDIA_ID_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(mediaId)
    ) {
      throw new Error('Invalid managed media identifier');
    }
    const fileName = Buffer.from(mediaId, 'base64url').toString('utf8');
    if (!this.isAllowedObjectKey(fileName)) {
      throw new Error('Invalid managed media identifier');
    }
    return fileName;
  }

  getFileNameForMediaId(mediaId: string): string {
    return this.fromMediaId(mediaId);
  }

  async isMediaReferenceOwnedByFirebaseUid(reference: string, firebaseUid: string): Promise<boolean> {
    if (!this.bucket || !reference.startsWith('/api/media/')) return false;
    try {
      const fileName = this.fromMediaId(reference.slice('/api/media/'.length));
      const [metadata] = await this.bucket.file(fileName).getMetadata();
      return metadata.metadata?.firebaseUid === firebaseUid;
    } catch {
      return false;
    }
  }

  getPrivateMediaUrl(fileName: string): string {
    return `/api/media/${this.toMediaId(fileName)}`;
  }

  async getSignedReadUrl(fileName: string, ttlMs = SIGNED_URL_TTL_MS): Promise<string> {
    if (!this.bucket || !this.isAllowedObjectKey(fileName)) {
      throw new Error('Firebase Storage is not available for managed media');
    }
    const [exists] = await this.bucket.file(fileName).exists();
    if (!exists) {
      throw new Error('Managed media object not found');
    }
    const [url] = await this.bucket.file(fileName).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMs,
    });
    return url;
  }

  async getSignedReadUrlForMediaId(mediaId: string): Promise<string> {
    return this.getSignedReadUrl(this.fromMediaId(mediaId));
  }

  /**
   * Delete one object previously returned by this service. This is used when
   * a remote upload succeeds but the database link cannot be committed.
   * The reference is decoded and prefix-checked before deletion.
   */
  async deleteMediaReference(reference: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    const fileName = reference.startsWith('/api/media/')
      ? this.fromMediaId(reference.slice('/api/media/'.length))
      : this.extractFileName(reference);
    if (!fileName || !this.isAllowedObjectKey(fileName)) {
      throw new Error('Invalid managed media reference');
    }

    await this.bucket.file(fileName).delete();
  }

  normalizeMediaReference(reference: string | null | undefined): string | null | undefined {
    if (!reference || reference.startsWith('/api/media/')) {
      return reference;
    }
    if (!this.bucket) {
      return reference;
    }

    try {
      const url = new URL(reference);
      let fileName: string | undefined;
      if (url.hostname === 'storage.googleapis.com') {
        const prefix = `/${this.bucket.name}/`;
        if (url.pathname.startsWith(prefix)) {
          fileName = decodeURIComponent(url.pathname.slice(prefix.length));
        }
      } else if (url.hostname === 'firebasestorage.googleapis.com') {
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        if (match?.[1] === this.bucket.name) {
          fileName = decodeURIComponent(match[2]);
        }
      }

      return fileName && this.isAllowedObjectKey(fileName)
        ? this.getPrivateMediaUrl(fileName)
        : reference;
    } catch {
      return reference;
    }
  }

  private async responseUrl(fileName: string, userId?: number, firebaseUid?: string): Promise<string> {
    return userId
      || firebaseUid
      ? this.getPrivateMediaUrl(fileName)
      : this.getSignedReadUrl(fileName);
  }

  async uploadProfilePicture(fileBuffer: Buffer, originalName: string, userId?: number, firebaseUid?: string): Promise<UploadResult> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      // Process image with sharp for optimization
       const processedBuffer = await sharp(fileBuffer, { limitInputPixels: UPLOAD_LIMITS.maxImagePixels })
        .resize(400, 400, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ 
          quality: 90,
          progressive: true 
        })
        .toBuffer();

      // Generate unique filename
      const timestamp = Date.now();
       const userPrefix = userId ? `user-${userId}` : 'temp';
      const fileName = `profile-pictures/${userPrefix}-${timestamp}-${uuidv4()}.jpg`;

      // Create file reference
      const file = this.bucket.file(fileName);

      // Upload file
      await file.save(processedBuffer, {
        resumable: false,
        metadata: {
          contentType: 'image/jpeg',
          cacheControl: 'private, max-age=3600',
          metadata: {
            uploadedAt: new Date().toISOString(),
             purpose: 'photo',
             userId: userId?.toString() || 'unknown',
             ...(firebaseUid ? { firebaseUid } : {}),
          }
        }
      });

       const mediaUrl = await this.responseUrl(fileName, userId, firebaseUid);
      logger.info('[Firebase Storage] Private profile picture uploaded');

      return {
        url: mediaUrl,
        fileName
      };
    } catch (error) {
      logger.error('[Firebase Storage] Error uploading profile picture', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error('Failed to upload profile picture', { cause: error });
    }
  }

  async deleteProfilePicture(fileName: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      if (!this.isAllowedObjectKey(fileName) || !fileName.startsWith('profile-pictures/')) {
        throw new Error('Invalid profile picture object key');
      }
      const file = this.bucket.file(fileName);
      await file.delete();
      logger.info('[Firebase Storage] Profile picture deleted');
    } catch (error) {
      logger.error('[Firebase Storage] Error deleting profile picture', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error('Failed to delete profile picture', { cause: error });
    }
  }

  async deleteOwnedMediaForUser(userId: number, firebaseUid?: string | null): Promise<void> {
    if (!this.bucket) return;
    // Uploads created by this service are namespaced by database user ID.
    // Never enumerate an entire shared bucket during an erasure request.
    const prefixes = [
      `profile-pictures/user-${userId}-`,
      `resumes/user-${userId}-`,
      `resume-previews/resumes/user-${userId}-`,
    ];
    const listed = await Promise.all(prefixes.map((prefix) => this.bucket!.getFiles({ prefix })));
    const filesToCheck = listed.flatMap(([files]) => files);
    for (const file of filesToCheck) {
      const [metadata] = await file.getMetadata();
      const ownerId = metadata.metadata?.userId;
      const ownerUid = metadata.metadata?.firebaseUid;
      if (ownerId === String(userId) || (firebaseUid && ownerUid === firebaseUid)) {
        await file.delete();
      }
    }
    logger.info('[Firebase Storage] Deleted owned media for account-erasure job');
  }

  // Extract filename from Firebase Storage URL for deletion
  extractFileName(url: string): string | null {
    try {
      const parsed = new URL(url);
      const encodedPath = parsed.hostname === 'storage.googleapis.com'
        ? parsed.pathname.split('/').slice(2).join('/')
        : parsed.hostname === 'firebasestorage.googleapis.com'
          ? parsed.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/)?.[1]
          : undefined;
      if (!encodedPath) return null;
      const fileName = decodeURIComponent(encodedPath);
      return this.isAllowedObjectKey(fileName) ? fileName : null;
    } catch {
      return null;
    }
  }

  async uploadResume(fileBuffer: Buffer, originalName: string, userId?: number, firebaseUid?: string): Promise<ResumeUploadResult> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      // Generate unique filename
      const timestamp = Date.now();
      const userPrefix = userId ? `user-${userId}` : 'temp';
      const fileExtension = path.extname(originalName).toLowerCase();
      const fileName = `resumes/${userPrefix}-${timestamp}-${uuidv4()}${fileExtension}`;

      // Create file reference
      const file = this.bucket.file(fileName);

      // Determine content type based on file extension
      let contentType = 'application/octet-stream';
      if (fileExtension === '.pdf') {
        contentType = 'application/pdf';
      } else if (fileExtension === '.doc') {
        contentType = 'application/msword';
      } else if (fileExtension === '.docx') {
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }

      // Upload file
      await file.save(fileBuffer, {
        resumable: false,
        metadata: {
          contentType,
          cacheControl: 'private, max-age=3600',
          metadata: {
            uploadedAt: new Date().toISOString(),
             purpose: 'resume',
             userId: userId?.toString() || 'unknown',
             ...(firebaseUid ? { firebaseUid } : {}),
          }
        }
      });

       const mediaUrl = await this.responseUrl(fileName, userId, firebaseUid);
      logger.info('[Firebase Storage] Private resume uploaded');

      // Generate preview URLs if it's a PDF
      let previewUrls: string[] = [];
      if (fileExtension === '.pdf') {
        try {
           previewUrls = await this.generatePdfPreviewsFromBuffer(fileBuffer, fileName, userId, firebaseUid);
        } catch (previewError) {
           logger.error('[Firebase Storage] Error generating PDF previews', {
             errorClass: previewError instanceof Error ? previewError.name : 'UnknownError',
           });
          // Continue without previews rather than failing the entire upload
        }
      }

      return {
        url: mediaUrl,
        fileName,
        previewUrls
      };
    } catch (error) {
      logger.error('[Firebase Storage] Error uploading resume', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error('Failed to upload resume', { cause: error });
    }
  }

  private async generatePdfPreviewsFromBuffer(pdfBuffer: Buffer, fileName: string, userId?: number, firebaseUid?: string): Promise<string[]> {
    const tempDir = '/tmp';
    const tempPdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
    let previewDir: string | undefined;
    const previewUrls: string[] = [];
    const uploadedPreviewFileNames: string[] = [];

    try {
      // Write PDF buffer to temporary file
      await fs.promises.writeFile(tempPdfPath, pdfBuffer);

      // Create temporary directory for previews
      const previewDirName = `preview-${Date.now()}`;
      previewDir = path.join(tempDir, previewDirName);
      await fs.promises.mkdir(previewDir, { recursive: true });

      // Generate JPEG previews
      const outputPrefix = path.join(previewDir, 'page');
      logger.debug('[Firebase Storage] Generating PDF previews');
       await execFileAsync('pdftoppm', [
        '-jpeg',
        '-r',
        '200',
        '-scale-to',
        '1200',
         '-f',
         '1',
         '-l',
         String(UPLOAD_LIMITS.maxPreviewPages),
        tempPdfPath,
        outputPrefix,
      ], { timeout: 15_000 });

      // Get generated preview files
      const files = await fs.promises.readdir(previewDir);
       const previewFiles = files
        .filter(f => f.endsWith('.jpg'))
        .sort((a, b) => {
          const pageA = parseInt(a.match(/-(\d+)\.jpg$/)?.[1] || '0');
          const pageB = parseInt(b.match(/-(\d+)\.jpg$/)?.[1] || '0');
          return pageA - pageB;
        });

       if (previewFiles.length > UPLOAD_LIMITS.maxPreviewPages) {
         throw new Error(`PDF exceeds the ${UPLOAD_LIMITS.maxPreviewPages}-page preview limit.`);
       }

      // Upload each preview to Firebase Storage
      for (const previewFile of previewFiles) {
        const previewPath = path.join(previewDir, previewFile);
        const previewBuffer = await fs.promises.readFile(previewPath);

        // Optimize with sharp
         const optimizedBuffer = await sharp(previewBuffer, { limitInputPixels: UPLOAD_LIMITS.maxImagePixels })
          .jpeg({
            quality: 90,
            progressive: true
          })
          .toBuffer();

        // Upload to Firebase Storage
        const previewFileName = `resume-previews/${fileName.replace('.pdf', '')}-${previewFile}`;
        const previewFileRef = this.bucket!.file(previewFileName);

        await previewFileRef.save(optimizedBuffer, {
          resumable: false,
          metadata: {
            contentType: 'image/jpeg',
            cacheControl: 'private, max-age=3600',
            metadata: {
             originalPdf: fileName,
             purpose: 'resume-preview',
              uploadedAt: new Date().toISOString(),
               userId: userId?.toString() || 'unknown',
               ...(firebaseUid ? { firebaseUid } : {}),
            }
          }
        });
         uploadedPreviewFileNames.push(previewFileName);

         const previewUrl = await this.responseUrl(previewFileName, userId, firebaseUid);
        previewUrls.push(previewUrl);
      }

      logger.info('[Firebase Storage] Generated private resume previews', {
        count: previewUrls.length,
      });

      return previewUrls;
    } catch (error) {
      await Promise.allSettled(
        uploadedPreviewFileNames.map((previewFileName) => this.bucket!.file(previewFileName).delete()),
      );
      logger.error('[Firebase Storage] Error generating PDF previews', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    } finally {
      // Both success and failure paths remove the local PDF and preview
      // directory. Remote objects are addressed separately by their managed
      // references and are never implicitly enumerated here.
      await fs.promises.unlink(tempPdfPath).catch(() => {});
      if (previewDir) {
        await fs.promises.rm(previewDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async deleteResume(fileName: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      if (!this.isAllowedObjectKey(fileName) || !fileName.startsWith('resumes/')) {
        throw new Error('Invalid resume object key');
      }
      const file = this.bucket.file(fileName);
      await file.delete();
      logger.info('[Firebase Storage] Resume deleted');
    } catch (error) {
      logger.error('[Firebase Storage] Error deleting resume', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error('Failed to delete resume', { cause: error });
    }
  }

  // Check if Firebase Storage is available
  isAvailable(): boolean {
    return !!this.bucket;
  }
}

export const firebaseStorageService = new FirebaseStorageService();