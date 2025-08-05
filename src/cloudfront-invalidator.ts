import { CloudFrontClient, CreateInvalidationCommand, GetInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { EventBus, EventTypes } from '@orcdkestrator/core';

/**
 * Invalidation options
 */
export interface InvalidationOptions {
  site: string;
  region?: string;
  profile?: string;
  waitForCompletion?: boolean;
  maxWaitTime?: number; // Maximum wait time in seconds
}

/**
 * Invalidation result
 */
export interface InvalidationResult {
  invalidationId: string;
  status: 'InProgress' | 'Completed';
  success: boolean;
  error?: string;
}

/**
 * Handles CloudFront invalidations for static sites
 */
export class CloudFrontInvalidator {
  private readonly eventBus: EventBus;
  private cloudFrontClient: CloudFrontClient | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Initialize CloudFront client with configuration
   */
  private initializeCloudFrontClient(region: string, profile?: string): void {
    const clientConfig: any = {
      region: region || 'us-east-1'
    };

    // If profile is specified, AWS SDK will handle profile resolution automatically
    if (profile) {
      process.env.AWS_PROFILE = profile;
    }

    this.cloudFrontClient = new CloudFrontClient(clientConfig);
  }

  /**
   * Create CloudFront invalidation
   */
  async invalidate(
    distributionId: string,
    paths: string[],
    options: InvalidationOptions
  ): Promise<InvalidationResult> {
    this.initializeCloudFrontClient(options.region || 'us-east-1', options.profile);

    if (!this.cloudFrontClient) {
      throw new Error('Failed to initialize CloudFront client');
    }

    this.eventBus.emitEvent(
      EventTypes['s3-sites:before:invalidation'],
      {
        site: options.site,
        distributionId,
        paths
      },
      'CloudFrontInvalidator'
    );

    try {
      // Create invalidation
      const invalidationId = await this.createInvalidation(distributionId, paths);
      
      let status: 'InProgress' | 'Completed' = 'InProgress';
      
      // Wait for completion if requested
      if (options.waitForCompletion) {
        console.log(`[s3-sites] Waiting for CloudFront invalidation ${invalidationId} to complete...`);
        status = await this.waitForInvalidation(distributionId, invalidationId, options);
      }

      this.eventBus.emitEvent(
        EventTypes['s3-sites:after:invalidation'],
        {
          site: options.site,
          distributionId,
          invalidationId,
          success: true
        },
        'CloudFrontInvalidator'
      );

      return {
        invalidationId,
        status,
        success: true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.eventBus.emitEvent(
        EventTypes['s3-sites:after:invalidation'],
        {
          site: options.site,
          distributionId,
          invalidationId: '',
          success: false
        },
        'CloudFrontInvalidator'
      );

      return {
        invalidationId: '',
        status: 'InProgress',
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Create CloudFront invalidation
   */
  private async createInvalidation(distributionId: string, paths: string[]): Promise<string> {
    const command = new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        Paths: {
          Quantity: paths.length,
          Items: paths
        },
        CallerReference: this.generateCallerReference()
      }
    });

    const response = await this.cloudFrontClient!.send(command);
    
    if (!response.Invalidation?.Id) {
      throw new Error('Failed to create CloudFront invalidation - no ID returned');
    }

    console.log(`[s3-sites] Created CloudFront invalidation: ${response.Invalidation.Id}`);
    return response.Invalidation.Id;
  }

  /**
   * Wait for invalidation to complete
   */
  private async waitForInvalidation(
    distributionId: string,
    invalidationId: string,
    options: InvalidationOptions
  ): Promise<'InProgress' | 'Completed'> {
    const maxWaitTime = options.maxWaitTime || 300; // 5 minutes default
    const checkInterval = 10; // 10 seconds
    const maxChecks = Math.floor(maxWaitTime / checkInterval);
    
    for (let check = 0; check < maxChecks; check++) {
      try {
        const command = new GetInvalidationCommand({
          DistributionId: distributionId,
          Id: invalidationId
        });

        const response = await this.cloudFrontClient!.send(command);
        const status = response.Invalidation?.Status;

        if (status === 'Completed') {
          console.log(`[s3-sites] ✅ CloudFront invalidation completed`);
          return 'Completed';
        }

        // Emit progress
        const progress = Math.round((check / maxChecks) * 100);
        this.eventBus.emitEvent(
          EventTypes['s3-sites:deployment:progress'],
          {
            site: options.site,
            stage: 'invalidating',
            progress,
            message: `Waiting for CloudFront invalidation (${check * checkInterval}s)`
          },
          'CloudFrontInvalidator'
        );

        console.log(`[s3-sites] CloudFront invalidation status: ${status} (${check * checkInterval}s elapsed)`);
        
        // Wait before next check
        await this.sleep(checkInterval * 1000);

      } catch (error) {
        console.warn(`[s3-sites] Failed to check invalidation status: ${error}`);
        // Continue waiting despite check failures
      }
    }

    console.log(`[s3-sites] ⏰ CloudFront invalidation still in progress after ${maxWaitTime}s`);
    return 'InProgress';
  }

  /**
   * Generate unique caller reference for invalidation
   */
  private generateCallerReference(): string {
    const timestamp = new Date().toISOString();
    const random = Math.random().toString(36).substring(2, 8);
    return `orcdkestrator-${timestamp}-${random}`;
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}