/**
 * File Upload Security Validator
 * 
 * Validates file uploads for security:
 * - File size limits
 * - Blocked file types (XSS risks)
 * - Content verification
 */

/**
 * Maximum file size: 100MB
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Blocked MIME types that pose security risks
 */
export const BLOCKED_MIME_TYPES = [
  'image/svg+xml', // SVG can contain JavaScript (XSS risk)
  'application/xml',
  'text/xml',
  'application/x-shockwave-flash',
  'application/x-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-msdos-windows',
  'application/x-msi',
  'application/x-ole-storage',
  'application/x-sh',
  'application/x-shellscript',
  'text/x-shellscript',
  'application/x-ms-wim',
  'application/x-ms-wmd',
  'application/x-ms-wmz',
  'application/x-ms-xbap',
  'application/x-msaccess',
  'application/x-msaccess',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-word.document.macroEnabled.12',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
];

/**
 * Blocked file extensions
 */
export const BLOCKED_EXTENSIONS = [
  '.svg',
  '.xml',
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.pif',
  '.scr',
  '.vbs',
  '.js',
  '.jar',
  '.app',
  '.deb',
  '.pkg',
  '.rpm',
  '.sh',
  '.msi',
  '.dll',
];

/**
 * Allowed image MIME types for logo uploads
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
];

/**
 * Allowed CSV MIME types
 */
export const ALLOWED_CSV_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain', // Some systems send CSV as text/plain
];

/**
 * File validation result
 */
export type FileValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Validate a file for security
 * 
 * @param file - File object to validate
 * @param allowedTypes - Optional array of allowed MIME types
 * @returns Validation result
 */
export function validateFile(
  file: File,
  allowedTypes?: string[]
): FileValidationResult {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check if file size is 0
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty',
    };
  }

  // Check blocked MIME types
  if (BLOCKED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed for security reasons`,
    };
  }

  // Check blocked extensions
  const fileName = file.name.toLowerCase();
  const hasBlockedExtension = BLOCKED_EXTENSIONS.some((ext) =>
    fileName.endsWith(ext)
  );
  if (hasBlockedExtension) {
    return {
      valid: false,
      error: `File extension is not allowed for security reasons`,
    };
  }

  // If allowed types specified, check against them
  if (allowedTypes && allowedTypes.length > 0) {
    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `File type ${file.type} is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate CSV file structure
 * 
 * Checks that the CSV has a reasonable structure (not empty, has headers).
 * This is a basic check - full validation should be done during parsing.
 * 
 * @param buffer - File buffer
 * @returns Validation result
 */
export async function validateCsvStructure(
  buffer: Buffer
): Promise<FileValidationResult> {
  try {
    const text = buffer.toString('utf-8');
    
    // Check file is not empty
    if (text.trim().length === 0) {
      return {
        valid: false,
        error: 'CSV file is empty',
      };
    }

    // Check has at least one line (header)
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return {
        valid: false,
        error: 'CSV file has no content',
      };
    }

    // Check first line (header) has content
    const header = lines[0];
    if (header.trim().length === 0) {
      return {
        valid: false,
        error: 'CSV file has no header row',
      };
    }

    // Check header has at least one column
    const columns = header.split(',').filter((col) => col.trim().length > 0);
    if (columns.length === 0) {
      return {
        valid: false,
        error: 'CSV file header has no columns',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate CSV structure: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

