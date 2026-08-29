import { firebaseStorage } from '../lib/firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { logger } from '../lib/logger';
const execFileAsync = promisify(execFile);

const MANAGED_MEDIA_PREFIXES = [
  'profile-pictures/',
  'resumes/',
  'resume-previews/',
  'legacy/',
] as const;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

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
    return MANAGED_MEDIA_PREFIXES.some((prefix) => fileName.startsWith(prefix))
      && !fileName.includes('..')
      && !fileName.startsWith('/');
  }

  private toMediaId(fileName: string): string {
    if (!this.isAllowedObjectKey(fileName)) {
      throw new Error('Invalid managed media object key');
    }
    return Buffer.from(fileName, 'utf8').toString('base64url');
  }

  private fromMediaId(mediaId: string): string {
    const fileName = Buffer.from(mediaId, 'base64url').toString('utf8');
    if (!this.isAllowedObjectKey(fileName)) {
      throw new Error('Invalid managed media identifier');
    }
    return fileName;
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

  private async responseUrl(fileName: string, userId?: number): Promise<string> {
    return userId
      ? this.getPrivateMediaUrl(fileName)
      : this.getSignedReadUrl(fileName);
  }

  async uploadProfilePicture(fileBuffer: Buffer, originalName: string, userId?: number): Promise<UploadResult> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      // Process image with sharp for optimization
      const processedBuffer = await sharp(fileBuffer)
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
            originalName,
            uploadedAt: new Date().toISOString(),
            userId: userId?.toString() || 'unknown'
          }
        }
      });

      const mediaUrl = await this.responseUrl(fileName, userId);
      logger.info('[Firebase Storage] Private profile picture uploaded', { fileName });

      return {
        url: mediaUrl,
        fileName
      };
    } catch (error) {
      logger.error('[Firebase Storage] Error uploading profile picture:', error);
       throw new Error(`Failed to upload profile picture: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  async deleteProfilePicture(fileName: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      const file = this.bucket.file(fileName);
      await file.delete();
      logger.info('[Firebase Storage] Profile picture deleted', { fileName });
    } catch (error) {
      logger.error('[Firebase Storage] Error deleting profile picture:', error);
      // Don't throw error for delete operations to avoid breaking user experience
    }
  }

  // Extract filename from Firebase Storage URL for deletion
  extractFileName(url: string): string | null {
    try {
      const matches = url.match(/\/([^/]+)$/);
      return matches ? matches[1] : null;
    } catch {
      return null;
    }
  }

  async uploadResume(fileBuffer: Buffer, originalName: string, userId?: number): Promise<ResumeUploadResult> {
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
            originalName,
            uploadedAt: new Date().toISOString(),
            userId: userId?.toString() || 'unknown'
          }
        }
      });

      const mediaUrl = await this.responseUrl(fileName, userId);
      logger.info('[Firebase Storage] Private resume uploaded', { fileName });

      // Generate preview URLs if it's a PDF
      let previewUrls: string[] = [];
      if (fileExtension === '.pdf') {
        try {
          previewUrls = await this.generatePdfPreviewsFromBuffer(fileBuffer, fileName, userId);
        } catch (previewError) {
          console.error('[Firebase Storage] Error generating PDF previews:', previewError);
          // Continue without previews rather than failing the entire upload
        }
      }

      return {
        url: mediaUrl,
        fileName,
        previewUrls
      };
    } catch (error) {
      logger.error('[Firebase Storage] Error uploading resume:', error);
       throw new Error(`Failed to upload resume: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  private async generatePdfPreviewsFromBuffer(pdfBuffer: Buffer, fileName: string, userId?: number): Promise<string[]> {
    const tempDir = '/tmp';
    const tempPdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
    const previewUrls: string[] = [];

    try {
      // Write PDF buffer to temporary file
      await fs.promises.writeFile(tempPdfPath, pdfBuffer);

      // Create temporary directory for previews
      const previewDirName = `preview-${Date.now()}`;
      const previewDir = path.join(tempDir, previewDirName);
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

      // Upload each preview to Firebase Storage
      for (const previewFile of previewFiles) {
        const previewPath = path.join(previewDir, previewFile);
        const previewBuffer = await fs.promises.readFile(previewPath);

        // Optimize with sharp
        const optimizedBuffer = await sharp(previewBuffer)
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
              uploadedAt: new Date().toISOString(),
              userId: userId?.toString() || 'unknown'
            }
          }
        });

        const previewUrl = await this.responseUrl(previewFileName, userId);
        previewUrls.push(previewUrl);
      }

      logger.info('[Firebase Storage] Generated private resume previews', {
        count: previewUrls.length,
      });

      // Cleanup temporary files
      await fs.promises.unlink(tempPdfPath);
      await fs.promises.rm(previewDir, { recursive: true });

      return previewUrls;
    } catch (error) {
      // Cleanup temporary files in case of error
      try {
        await fs.promises.unlink(tempPdfPath);
       } catch {
         // The temporary file may already be absent; continue cleanup and rethrow the original error.
       }
      
      logger.error('[Firebase Storage] Error generating PDF previews:', error);
      throw error;
    }
  }

  async deleteResume(fileName: string): Promise<void> {
    if (!this.bucket) {
      throw new Error('Firebase Storage not initialized');
    }

    try {
      const file = this.bucket.file(fileName);
      await file.delete();
      logger.info('[Firebase Storage] Resume deleted', { fileName });
    } catch (error) {
      logger.error('[Firebase Storage] Error deleting resume:', error);
      // Don't throw error for delete operations to avoid breaking user experience
    }
  }

  // Check if Firebase Storage is available
  isAvailable(): boolean {
    return !!this.bucket;
  }
}

export const firebaseStorageService = new FirebaseStorageService();