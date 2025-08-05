/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import { EventBus, EventTypes } from '@orcdkestrator/core';
import { S3DeploymentResult } from './types';

/**
 * Upload options for S3 deployment
 */
export interface S3UploadOptions {
  site: string;
  strategy: 'direct' | 'versioned';
  dryRun?: boolean;
  region?: string;
  profile?: string;
  versioning?: {
    enableVersionedDeployment?: boolean;
    versionPrefix?: string;
    keepVersions?: number;
  };
}

/**
 * File upload metadata
 */
interface FileUploadInfo {
  localPath: string;
  s3Key: string;
  size: number;
  contentType: string;
  etag?: string;
  needsUpload: boolean;
}

/**
 * Handles uploading static sites to S3 buckets
 */
export class S3Uploader {
  private readonly eventBus: EventBus;
  private s3Client: S3Client | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Initialize S3 client with configuration
   */
  private initializeS3Client(region: string, profile?: string): void {
    const clientConfig: any = {
      region: region || 'us-east-1'
    };

    // If profile is specified, AWS SDK will handle profile resolution automatically
    if (profile) {
      process.env.AWS_PROFILE = profile;
    }

    this.s3Client = new S3Client(clientConfig);
  }

  /**
   * Upload a static site to S3
   */
  async uploadSite(
    distPath: string,
    bucketName: string,
    options: S3UploadOptions
  ): Promise<S3DeploymentResult> {
    this.initializeS3Client(options.region || 'us-east-1', options.profile);

    if (!this.s3Client) {
      throw new Error('Failed to initialize S3 client');
    }

    const startTime = Date.now();
    
    try {
      // Get all files to upload
      const files = await this.scanFiles(distPath);
      const uploadInfo = await this.prepareUploads(files, distPath, bucketName, options);
      
      this.eventBus.emitEvent(
        EventTypes['s3-sites:before:upload'],
        {
          site: options.site,
          bucketName,
          fileCount: uploadInfo.length,
          totalSize: uploadInfo.reduce((sum, file) => sum + file.size, 0)
        },
        'S3Uploader'
      );

      // Filter files that need upload
      const filesToUpload = uploadInfo.filter(file => file.needsUpload);
      let uploadedFiles = 0;
      const skippedFiles = uploadInfo.length - filesToUpload.length;

      if (options.dryRun) {
        console.log(`[s3-sites] DRY RUN: Would upload ${filesToUpload.length} files to ${bucketName}`);
        filesToUpload.forEach(file => {
          console.log(`  ${file.s3Key} (${this.formatFileSize(file.size)})`);
        });
      } else {
        // Upload files
        for (const file of filesToUpload) {
          await this.uploadFile(file, bucketName);
          uploadedFiles++;
          
          // Emit progress
          const progress = Math.round((uploadedFiles / filesToUpload.length) * 100);
          this.eventBus.emitEvent(
            EventTypes['s3-sites:deployment:progress'],
            {
              site: options.site,
              stage: 'uploading',
              progress,
              message: `Uploaded ${file.s3Key}`
            },
            'S3Uploader'
          );
        }
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      const totalSize = uploadInfo.reduce((sum, file) => sum + file.size, 0);

      this.eventBus.emitEvent(
        EventTypes['s3-sites:after:upload'],
        {
          site: options.site,
          bucketName,
          uploadedFiles,
          skippedFiles,
          duration
        },
        'S3Uploader'
      );

      return {
        success: true,
        uploadedFiles,
        totalSize,
        duration,
        version: options.strategy === 'versioned' ? this.generateVersion() : undefined
      };

    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        uploadedFiles: 0,
        totalSize: 0,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Scan for all files in the distribution directory
   */
  private async scanFiles(distPath: string): Promise<string[]> {
    const files = await glob('**/*', {
      cwd: distPath,
      nodir: true,
      dot: true // Include hidden files like .htaccess
    });

    return files;
  }

  /**
   * Prepare upload information for all files
   */
  private async prepareUploads(
    files: string[],
    distPath: string,
    bucketName: string,
    options: S3UploadOptions
  ): Promise<FileUploadInfo[]> {
    const uploadInfo: FileUploadInfo[] = [];

    for (const file of files) {
      const localPath = path.join(distPath, file);
      const stats = await fs.promises.stat(localPath);
      
      // Generate S3 key
      let s3Key = file.replace(/\\/g, '/'); // Normalize path separators
      
      if (options.strategy === 'versioned') {
        const version = this.generateVersion();
        s3Key = `${version}/${s3Key}`;
      }

      const contentType = this.getContentType(file);
      const etag = await this.calculateETag(localPath);
      
      // Check if file needs upload (compare ETags)
      const needsUpload = await this.fileNeedsUpload(bucketName, s3Key, etag);

      uploadInfo.push({
        localPath,
        s3Key,
        size: stats.size,
        contentType,
        etag,
        needsUpload
      });
    }

    return uploadInfo;
  }

  /**
   * Check if file needs to be uploaded by comparing ETags
   */
  private async fileNeedsUpload(bucketName: string, s3Key: string, localETag: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: s3Key
      });

      const response = await this.s3Client!.send(command);
      const s3ETag = response.ETag?.replace(/"/g, ''); // Remove quotes from ETag
      
      return s3ETag !== localETag;
    } catch (error: any) {
      // If object doesn't exist or we can't access it, we need to upload
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return true;
      }
      // For other errors, assume we need to upload
      return true;
    }
  }

  /**
   * Upload a single file to S3
   */
  private async uploadFile(file: FileUploadInfo, bucketName: string): Promise<void> {
    const fileContent = await fs.promises.readFile(file.localPath);
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: file.s3Key,
      Body: fileContent,
      ContentType: file.contentType,
      CacheControl: this.getCacheControl(file.s3Key),
      Metadata: {
        'upload-timestamp': new Date().toISOString(),
        'local-path': file.localPath
      }
    });

    await this.s3Client!.send(command);
  }

  /**
   * Calculate ETag for local file (MD5 hash)
   */
  private async calculateETag(filePath: string): Promise<string> {
    const fileContent = await fs.promises.readFile(filePath);
    return crypto.createHash('md5').update(fileContent).digest('hex');
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return contentTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get cache control headers based on file type
   */
  private getCacheControl(s3Key: string): string {
    const fileName = path.basename(s3Key);
    const ext = path.extname(fileName).toLowerCase();
    
    // Cache static assets for 1 year
    const staticAssets = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    if (staticAssets.includes(ext)) {
      return 'public, max-age=31536000, immutable';
    }
    
    // Cache HTML files for 1 hour
    if (ext === '.html' || fileName === 'index.html') {
      return 'public, max-age=3600, must-revalidate';
    }
    
    // Default cache for other files
    return 'public, max-age=86400'; // 1 day
  }

  /**
   * Generate version string for versioned deployments
   */
  private generateVersion(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const random = Math.random().toString(36).substring(2, 8);
    return `v${timestamp}-${random}`;
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}