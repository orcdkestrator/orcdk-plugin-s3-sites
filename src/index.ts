/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { Plugin, PluginConfig, OrcdkConfig, EventBus, EventTypes } from '@orcdkestrator/core';
import * as fs from 'fs';
import * as path from 'path';
import { S3SitePatternDetector } from './pattern-detector';
import { StackInspector } from './stack-inspector';
import { S3SiteConfig, S3Site, S3SiteDeploymentOptions, S3SiteRequirements, S3DeploymentResult } from './types';
import { S3Uploader } from './s3-uploader';
import { CloudFrontInvalidator } from './cloudfront-invalidator';


/**
 * S3 Sites plugin for orcdkestrator
 * Enables deployment of static sites to S3 with CloudFront integration
 */
export class S3SitesPlugin implements Plugin {
  public readonly name = '@orcdkestrator/orcdk-plugin-s3-sites';
  public readonly version = '1.0.0';
  
  private config: S3SiteConfig = {};
  private orcdkConfig: OrcdkConfig | null = null;
  private eventBus!: EventBus;
  private patternDetector: S3SitePatternDetector | null = null;
  private stackInspector: StackInspector | null = null;
  private s3Uploader: S3Uploader | null = null;
  private cloudFrontInvalidator: CloudFrontInvalidator | null = null;
  
  async initialize(config: PluginConfig, orcdkConfig: OrcdkConfig): Promise<void> {
    this.config = config.config as S3SiteConfig || {};
    this.orcdkConfig = orcdkConfig;
    this.eventBus = EventBus.getInstance();
    
    
    // Initialize components
    this.patternDetector = new S3SitePatternDetector(process.cwd());
    
    // Initialize stack inspector for remote deployment capabilities
    if (this.config.enableRemoteDeployment) {
      this.stackInspector = new StackInspector();
    }
    
    // Initialize S3 uploader and CloudFront invalidator
    this.s3Uploader = new S3Uploader(this.eventBus);
    this.cloudFrontInvalidator = new CloudFrontInvalidator(this.eventBus);
    
    // Subscribe to events
    this.subscribeToEvents();
  }
  
  /**
   * Subscribe to orchestrator events
   */
  private subscribeToEvents(): void {
    // Pattern detection integration
    this.eventBus.on(EventTypes['orchestrator:before:pattern-detection'], async () => {
      await this.detectStaticSites();
    });
    
    // Environment scanning integration
    this.eventBus.on(EventTypes['environment:scan:completed'], async () => {
      // Environment scanner will pick up static site files automatically
    });
  }
  
  /**
   * Detect static sites in the project
   */
  async detectStaticSites(): Promise<void> {
    if (!this.config.autoDetect) {
      return;
    }
    
    const pattern = await this.patternDetector!.scan();
    
    // Store detected sites for later use
    if (pattern.sites.length > 0) {
      console.log(`[s3-sites] Detected ${pattern.sites.length} static site(s)`);
    }
  }
  
  /**
   * Deploy a static site to S3
   */
  async deploySite(site: S3Site, options: S3SiteDeploymentOptions): Promise<S3DeploymentResult> {
    // Check if this is a remote deployment
    if (this.config.enableRemoteDeployment && site.stackName) {
      return this.deploySiteRemote(site, options);
    }

    // Direct deployment (no stack inspection)
    return this.deploySiteLocal(site, options);
  }

  /**
   * Deploy a static site with stack inspection (remote deployment)
   */
  async deploySiteRemote(site: S3Site, options: S3SiteDeploymentOptions): Promise<S3DeploymentResult> {
    const { environment } = options;
    const startTime = Date.now();
    
    this.eventBus.emitEvent(
      EventTypes['s3-sites:before:site-deploy'],
      {
        site: site.name,
        environment,
        distDirectory: site.distDirectory
      },
      this.name
    );

    try {
      // Step 1: Inspect stack for S3 bucket and CloudFront distribution
      if (!site.stackName) {
        throw new Error(`Stack name not specified for site ${site.name}`);
      }

      console.log(`[s3-sites] Inspecting stack: ${site.stackName}...`);
      
      const inspectionResult = await this.stackInspector!.inspectStack(
        site.stackName,
        {
          profile: options.profile || this.config.stackInspection?.defaultProfile,
          region: options.region || this.config.stackInspection?.defaultRegion
        }
      );

      if (!inspectionResult.success) {
        throw new Error(`Stack inspection failed for ${site.stackName}: ${inspectionResult.error}`);
      }

      const siteRequirements = this.extractSiteRequirements(inspectionResult.requirements!);
      
      if (!siteRequirements.readyForDeployment) {
        throw new Error(
          `Stack ${site.stackName} is not ready for deployment. Status: ${inspectionResult.requirements?.status}`
        );
      }

      // Step 2: Deploy to S3 bucket
      const deploymentResult = await this.deploySiteToS3(site, siteRequirements, options);

      // Step 3: Invalidate CloudFront if distribution exists
      if (siteRequirements.distributionId && !options.dryRun) {
        await this.invalidateCloudFront(site, siteRequirements, deploymentResult);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      const result: S3DeploymentResult = {
        ...deploymentResult,
        duration
      };

      this.eventBus.emitEvent(
        EventTypes['s3-sites:after:site-deploy'],
        {
          site: site.name,
          environment,
          success: true,
          result
        },
        this.name
      );

      return result;

    } catch (error) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      const errorMessage = error instanceof Error ? error.message : String(error);

      const result: S3DeploymentResult = {
        success: false,
        uploadedFiles: 0,
        totalSize: 0,
        duration,
        error: errorMessage
      };

      this.eventBus.emitEvent(
        EventTypes['s3-sites:after:site-deploy'],
        {
          site: site.name,
          environment,
          success: false,
          result,
          error: errorMessage
        },
        this.name
      );

      throw error;
    }
  }

  /**
   * Deploy a static site (direct deployment without stack inspection)
   */
  async deploySiteLocal(site: S3Site, options: S3SiteDeploymentOptions): Promise<S3DeploymentResult> {
    if (!site.bucketName) {
      throw new Error(`Bucket name not specified for site ${site.name}. Use stack inspection or provide bucketName.`);
    }

    const siteRequirements: S3SiteRequirements = {
      stackName: site.stackName || 'direct',
      region: options.region || 'us-east-1',
      bucketName: site.bucketName,
      distributionId: site.distributionId,
      bucketArn: `arn:aws:s3:::${site.bucketName}`,
      outputs: {},
      readyForDeployment: true
    };

    return this.deploySiteToS3(site, siteRequirements, options);
  }

  /**
   * Deploy site files to S3 bucket
   */
  private async deploySiteToS3(
    site: S3Site, 
    requirements: S3SiteRequirements, 
    options: S3SiteDeploymentOptions
  ): Promise<S3DeploymentResult> {
    const distPath = path.join(site.path, site.distDirectory);
    
    // Check if dist directory exists
    if (!fs.existsSync(distPath)) {
      throw new Error(
        `Distribution directory not found: ${distPath}\n` +
        `Make sure to build your site first, or check the distDirectory setting.`
      );
    }

    // Get deployment strategy
    const strategy = this.config.deploymentStrategy || 'direct';
    
    return this.s3Uploader!.uploadSite(
      distPath,
      requirements.bucketName,
      {
        site: site.name,
        strategy,
        dryRun: options.dryRun,
        region: requirements.region,
        profile: options.profile,
        versioning: this.config.versioning
      }
    );
  }

  /**
   * Invalidate CloudFront distribution
   */
  private async invalidateCloudFront(
    site: S3Site,
    requirements: S3SiteRequirements,
    deploymentResult: S3DeploymentResult
  ): Promise<void> {
    if (!requirements.distributionId || !this.config.cloudFront?.enableInvalidation) {
      return;
    }

    const invalidationPaths = this.config.cloudFront.invalidationPaths || ['/*'];
    
    const invalidationResult = await this.cloudFrontInvalidator!.invalidate(
      requirements.distributionId,
      invalidationPaths,
      {
        site: site.name,
        region: requirements.region,
        waitForCompletion: this.config.cloudFront.waitForInvalidation
      }
    );

    // Update deployment result with invalidation ID
    deploymentResult.invalidationId = invalidationResult.invalidationId;
  }

  /**
   * Extract S3 site requirements from stack inspection result
   */
  private extractSiteRequirements(stackRequirements: any): S3SiteRequirements {
    const outputs = stackRequirements.outputs || {};
    
    // Look for S3 bucket name in common output patterns
    const bucketName = this.findStackOutput(outputs, [
      'BucketName',
      'S3BucketName', 
      'WebsiteBucket',
      'StaticSiteBucket',
      'Bucket'
    ]);

    if (!bucketName) {
      throw new Error(
        'S3 bucket name not found in stack outputs. ' +
        'Expected outputs: BucketName, S3BucketName, WebsiteBucket, StaticSiteBucket, or Bucket'
      );
    }

    // Look for CloudFront distribution ID (optional)
    const distributionId = this.findStackOutput(outputs, [
      'DistributionId',
      'CloudFrontDistributionId',
      'CDNDistributionId',
      'Distribution'
    ]);

    return {
      stackName: stackRequirements.stackName,
      region: stackRequirements.region,
      bucketName,
      distributionId,
      bucketArn: `arn:aws:s3:::${bucketName}`,
      outputs,
      readyForDeployment: stackRequirements.readyForDeployment
    };
  }

  /**
   * Find stack output by trying multiple common names
   */
  private findStackOutput(outputs: Record<string, string>, names: string[]): string | undefined {
    for (const name of names) {
      if (outputs[name]) {
        return outputs[name];
      }
    }
    return undefined;
  }

  /**
   * Inspect a CloudFormation stack for S3 site requirements
   */
  async inspectStack(stackName: string, profile?: string, region?: string): Promise<any> {
    if (!this.stackInspector) {
      throw new Error('Stack inspection is not enabled. Set enableRemoteDeployment: true in plugin config.');
    }

    const profileConfig = {
      profile: profile || this.config.stackInspection?.defaultProfile,
      region: region || this.config.stackInspection?.defaultRegion
    };

    return await this.stackInspector.inspectStack(stackName, profileConfig);
  }
  
  async cleanup(): Promise<void> {
    // Unsubscribe from events
    this.eventBus.removeAllListeners(EventTypes['orchestrator:before:pattern-detection']);
    this.eventBus.removeAllListeners(EventTypes['environment:scan:completed']);
  }
}

// Export as default for plugin loading
export default S3SitesPlugin;