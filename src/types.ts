/**
 * Type definitions for S3 Sites plugin
 */

export interface S3SitePattern {
  type: 's3-sites';
  sites: S3Site[];
}

export interface S3Site {
  name: string;
  path: string;
  distDirectory: string;
  stackName?: string;
  dependencies: string[];
  bucketName?: string;
  distributionId?: string;
}

export interface S3SiteConfig {
  distDirectory?: string;
  deploymentStrategy?: 'direct' | 'versioned';
  enableRemoteDeployment?: boolean;
  stackInspection?: {
    enabled?: boolean;
    cacheResults?: boolean;
    defaultProfile?: string;
    defaultRegion?: string;
  };
  autoDetect?: boolean;
  versioning?: {
    enableVersionedDeployment?: boolean;
    versionPrefix?: string;
    keepVersions?: number;
  };
  cloudFront?: {
    enableInvalidation?: boolean;
    invalidationPaths?: string[];
    waitForInvalidation?: boolean;
  };
}

export interface S3SiteDeploymentOptions {
  environment: string;
  dryRun?: boolean;
  force?: boolean;
  profile?: string;
  region?: string;
}

export interface S3SiteRequirements {
  stackName: string;
  region: string;
  bucketName: string;
  distributionId?: string;
  bucketArn: string;
  outputs: Record<string, string>;
  readyForDeployment: boolean;
}

export interface S3DeploymentResult {
  success: boolean;
  uploadedFiles: number;
  totalSize: number;
  duration: number;
  version?: string;
  invalidationId?: string;
  error?: string;
}

export interface S3SiteEventPayloads {
  's3-sites:before:pattern-detection': {
    projectRoot: string;
  };
  
  's3-sites:after:pattern-detection': {
    pattern: S3SitePattern;
    sitesFound: number;
    sites: string[];
  };

  's3-sites:before:site-deploy': {
    site: string;
    environment: string;
    distDirectory: string;
  };

  's3-sites:after:site-deploy': {
    site: string;
    environment: string;
    success: boolean;
    result?: S3DeploymentResult;
    error?: string;
  };

  's3-sites:before:upload': {
    site: string;
    bucketName: string;
    fileCount: number;
    totalSize: number;
  };

  's3-sites:after:upload': {
    site: string;
    bucketName: string;
    uploadedFiles: number;
    skippedFiles: number;
    duration: number;
  };

  's3-sites:before:invalidation': {
    site: string;
    distributionId: string;
    paths: string[];
  };

  's3-sites:after:invalidation': {
    site: string;
    distributionId: string;
    invalidationId: string;
    success: boolean;
  };

  's3-sites:stack:inspection:failed': {
    site: string;
    stackName: string;
    error: string;
  };

  's3-sites:deployment:progress': {
    site: string;
    stage: 'uploading' | 'invalidating' | 'completed';
    progress: number;
    message: string;
  };
}

export interface PackageJsonSite {
  name: string;
  scripts?: {
    build?: string;
    [key: string]: string | undefined;
  };
  main?: string;
  homepage?: string;
}