import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './lib/logger';
import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_RESUME_EXTENSIONS,
  ALLOWED_RESUME_MIME_TYPES,
  generateSafeFilename,
  getSafeExtension,
  isAllowedMimeType,
  matchesMagicBytes,
} from './lib/upload-validation';

const execFileAsync = promisify(execFile);

// Check if pdftoppm is available
let pdftoppmAvailable: boolean | null = null;

async function checkPdftoppmAvailability(): Promise<boolean> {
  if (pdftoppmAvailable !== null) {
    return pdftoppmAvailable;
  }
  
  try {
    await execFileAsync('pdftoppm', ['-h']);
    pdftoppmAvailable = true;
    logger.debug('[PDF Processing] pdftoppm is available');
    return true;
  } catch {
    pdftoppmAvailable = false;
    logger.warn('[PDF Processing] pdftoppm not available - PDF previews will be disabled');
    return false;
  }
}

// Create uploads directory if it doesn't exist
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage.
// Stored filenames are generated server-side (timestamp + random hex) and are
// completely independent of user-supplied names, which prevents path
// traversal and shell-metacharacter issues downstream.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure the uploads directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const allowed = [...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_RESUME_EXTENSIONS];
    const filename = generateSafeFilename(file.originalname, allowed);
    if (!filename) {
      return cb(new Error('Invalid file type.'), '');
    }
    logger.debug(`[Upload Storage] Generated safe filename: ${filename}`);
    cb(null, filename);
  }
});

const imageFileFilter: NonNullable<multer.Options['fileFilter']> = (req, file, cb) => {
  const ext = getSafeExtension(file.originalname, ALLOWED_IMAGE_EXTENSIONS);
  if (ext && isAllowedMimeType(file.mimetype, ALLOWED_IMAGE_MIME_TYPES)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, JPEG, and PNG images are allowed.'));
  }
};

const resumeFileFilter: NonNullable<multer.Options['fileFilter']> = (req, file, cb) => {
  const ext = getSafeExtension(file.originalname, ALLOWED_RESUME_EXTENSIONS);
  if (ext && isAllowedMimeType(file.mimetype, ALLOWED_RESUME_MIME_TYPES)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
  }
};

async function generatePdfPreviews(pdfPath: string): Promise<string[]> {
  try {
    logger.debug('[PDF Processing] Starting PDF preview generation');

    // Check if pdftoppm is available
    const isAvailable = await checkPdftoppmAvailability();
    if (!isAvailable) {
      logger.debug('[PDF Processing] pdftoppm not available, skipping preview generation');
      return [];
    }

    // Create a unique directory for this PDF's previews
    const timestamp = Date.now();
    const previewDirName = `preview-${timestamp}`;
    const previewDir = path.join(uploadDir, previewDirName);
    await fs.promises.mkdir(previewDir, { recursive: true });

    // Use the preview directory for output
    const outputPrefix = path.join(previewDir, 'page');

    // Generate JPEG previews with high quality.
    // execFile passes arguments directly (no shell), which eliminates
    // shell-injection risk from filenames. Timeout kills runaway processes.
    const { stderr } = await execFileAsync(
      'pdftoppm',
      ['-jpeg', '-r', '200', '-scale-to', '1200', pdfPath, outputPrefix],
      { timeout: 8000 }
    );

    if (stderr) {
      logger.debug('[PDF Processing] pdftoppm stderr:', stderr);
    }

    // Get all generated preview files
    const files = await fs.promises.readdir(previewDir);
    logger.debug(`[PDF Processing] Generated ${files.length} preview file(s)`);

    const previewFiles = files
      .filter(f => f.endsWith('.jpg'))
      .sort((a, b) => {
        const pageA = parseInt(a.match(/-(\d+)\.jpg$/)?.[1] || '0');
        const pageB = parseInt(b.match(/-(\d+)\.jpg$/)?.[1] || '0');
        return pageA - pageB;
      });

    logger.debug(`[PDF Processing] Sorted ${previewFiles.length} preview file(s)`);

    // Process each preview file with sharp
    for (const file of previewFiles) {
      const filePath = path.join(previewDir, file);
      await sharp(filePath)
        .jpeg({
          quality: 90,
          progressive: true
        })
        .toBuffer()
        .then(buffer => fs.promises.writeFile(filePath, buffer));
    }

    // Generate absolute URLs for the preview files
    const previewUrls = previewFiles.map(filename => {
      // Ensure the URL is properly formatted with the correct path
      const relativePath = path.join(previewDirName, filename).replace(/\\/g, '/');
      return `/uploads/${relativePath}`;
    });

    logger.debug(`[PDF Processing] Generated ${previewUrls.length} preview URL(s)`);
    return previewUrls;
  } catch (error) {
    logger.error('[PDF Processing] Error generating PDF previews:', error);
    // Return empty array instead of throwing to allow graceful fallback
    return [];
  }
}

/**
 * Verify that an uploaded file's contents match its extension using magic
 * bytes. Deletes the file and throws when the contents do not match, so
 * renamed/disguised files never persist on disk.
 */
export async function verifyUploadedFile(filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const header = Buffer.alloc(16);
  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    await fileHandle.read(header, 0, 16, 0);
  } finally {
    await fileHandle.close();
  }

  if (!matchesMagicBytes(header, ext)) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw new Error('File contents do not match the file type.');
  }
}

export const uploadResume = multer({
  storage: storage,
  fileFilter: resumeFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export const uploadPhoto = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB limit for high-resolution smartphone photos
  }
});

export async function processResumeUpload(input: Express.Multer.File | string): Promise<{ url: string; previewUrls: string[] }> {
  try {
    let fileUrl: string;
    let filePath: string;

    if (typeof input === 'string') {
      fileUrl = input;
      filePath = path.join(uploadDir, path.basename(input));
    } else {
      logger.debug(`[Resume Processing] Processing upload (${input.mimetype}, ${input.size} bytes)`);
      // Ensure the URL uses forward slashes and is relative to the root
      fileUrl = `/uploads/${path.basename(input.path)}`.replace(/\\/g, '/');
      filePath = input.path;
    }

    let previewUrls: string[] = [];

    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      logger.error('[Resume Processing] Uploaded file not found on disk');
      throw new Error('File not found');
    }

    // Check if the file is a PDF
    const fileContent = await fs.promises.readFile(filePath);
    const isPDF = fileContent.toString('hex').startsWith('255044462d'); // PDF magic number

    if (isPDF) {
      logger.debug('[Resume Processing] File is a PDF, attempting preview generation...');
      try {
        previewUrls = await generatePdfPreviews(filePath);
        if (previewUrls.length > 0) {
          logger.debug(`[Resume Processing] Preview generation completed: ${previewUrls.length} preview(s)`);
        } else {
          logger.debug('[Resume Processing] Preview generation completed but no previews generated (pdftoppm may be unavailable)');
        }
      } catch (error) {
        logger.error('[Resume Processing] Preview generation failed, continuing without previews:', error);
        previewUrls = [];
      }
    } else {
      logger.debug('[Resume Processing] File is not a PDF (DOC/DOCX), skipping preview generation');
    }

    return {
      url: fileUrl,
      previewUrls
    };
  } catch (error) {
    logger.error('[Resume Processing] Error processing resume upload:', error);
    throw error;
  }
}