# S3 Sites Plugin API Reference

## Plugin Configuration

```typescript
interface S3SiteConfig {
  enabled: boolean;
  sites?: S3Site[];
  enableRemoteDeployment?: boolean;
}

interface S3Site {
  name: string;
  source: string;
  bucketName?: string;
  distributionId?: string;
  stackName?: string;
  invalidate?: boolean;
  deleteBeforeUpload?: boolean;
  cacheControl?: Record<string, string>;
}
```

## Lifecycle Hooks

### `afterStackDeploy`
Deploys static sites to S3 buckets after CDK stack deployment.

### `beforeStackDestroy`
Optionally cleans up S3 buckets before stack destruction.

## Methods

### `initialize(config: PluginConfig, orcdkConfig: OrcdkConfig): Promise<void>`
Initializes the plugin and validates site configurations.

### `deploySite(site: S3Site, options: S3SiteDeploymentOptions): Promise<S3DeploymentResult>`
Deploys a single site to S3.

### `uploadFiles(bucketName: string, files: FileUpload[]): Promise<void>`
Uploads files to S3 with proper content types and cache headers.

### `invalidateDistribution(distributionId: string, paths: string[]): Promise<void>`
Creates a CloudFront invalidation for the specified paths.

### `inspectStack(stackName: string, profile?: string, region?: string): Promise<StackRequirements>`
Inspects a CloudFormation stack to extract S3 bucket and CloudFront distribution information.

## Types

```typescript
interface S3DeploymentResult {
  bucketName: string;
  filesUploaded: number;
  bytesUploaded: number;
  distributionInvalidated: boolean;
  deploymentTime: number;
}

interface FileUpload {
  key: string;
  path: string;
  contentType: string;
  cacheControl?: string;
}
```
