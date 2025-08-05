/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { CloudFormationClient, DescribeStacksCommand, DescribeStacksCommandOutput, Stack } from '@aws-sdk/client-cloudformation';
import { EventBus, EventTypes } from '@orcdkestrator/core';

/**
 * Simplified stack requirements for S3 site deployment
 */
export interface StackRequirements {
  stackName: string;
  region: string;
  outputs: Record<string, string>;
  status: 'CREATE_COMPLETE' | 'UPDATE_COMPLETE' | 'ROLLBACK_COMPLETE' | 'DELETE_COMPLETE' | 'PENDING' | 'FAILED';
  readyForDeployment: boolean;
}

/**
 * Stack inspection result for S3 sites
 */
export interface StackInspectionResult {
  success: boolean;
  requirements?: StackRequirements;
  error?: string;
  recommendations?: string[];
}

/**
 * AWS profile configuration for stack inspection
 */
export interface AWSProfileConfig {
  profile?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

/**
 * Simplified CloudFormation stack inspector for S3 site deployment
 * Focused on extracting S3 bucket and CloudFront distribution information
 */
export class StackInspector {
  private readonly eventBus: EventBus;
  private cloudFormationClient: CloudFormationClient | null = null;

  constructor() {
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Initialize AWS clients with profile configuration
   */
  private initializeClients(config: AWSProfileConfig): void {
    const clientConfig: any = {
      region: config.region || process.env.AWS_REGION || 'us-east-1'
    };

    // If specific credentials are provided, use them
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken
      };
    }
    // If profile is specified, AWS SDK will handle profile resolution automatically
    else if (config.profile) {
      // AWS SDK will use the profile from ~/.aws/credentials and ~/.aws/config
      process.env.AWS_PROFILE = config.profile;
    }

    this.cloudFormationClient = new CloudFormationClient(clientConfig);
  }

  /**
   * Inspect a CloudFormation stack and extract S3 site requirements
   */
  async inspectStack(
    stackName: string, 
    profileConfig: AWSProfileConfig = {}
  ): Promise<StackInspectionResult> {
    this.emitBeforeInspectionEvent(stackName, profileConfig);

    try {
      this.initializeClients(profileConfig);

      if (!this.cloudFormationClient) {
        throw new Error('Failed to initialize CloudFormation client');
      }

      const stackData = await this.getStackDetails(stackName);
      
      if (!stackData) {
        return {
          success: false,
          error: `Stack '${stackName}' not found or not accessible`,
          recommendations: [
            'Verify the stack name is correct',
            'Check that the stack exists in the specified region',
            'Ensure your AWS credentials have permission to describe the stack'
          ]
        };
      }

      const requirements = this.extractRequirements(stackData, profileConfig);
      
      this.emitAfterInspectionEvent(stackName, requirements);

      return {
        success: true,
        requirements
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.emitInspectionErrorEvent(stackName, errorMessage);

      return {
        success: false,
        error: errorMessage,
        recommendations: this.generateErrorRecommendations(error)
      };
    }
  }

  /**
   * Get stack details from CloudFormation
   */
  private async getStackDetails(stackName: string): Promise<Stack | null> {
    if (!this.cloudFormationClient) {
      throw new Error('CloudFormation client not initialized');
    }

    try {
      const command = new DescribeStacksCommand({ StackName: stackName });
      const response: DescribeStacksCommandOutput = await this.cloudFormationClient.send(command);
      
      return response.Stacks?.[0] || null;
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Extract requirements from stack data
   */
  private extractRequirements(
    stack: Stack, 
    profileConfig: AWSProfileConfig
  ): StackRequirements {
    const outputs = this.extractOutputs(stack);

    // Determine if stack is ready for deployment
    const readyForDeployment = this.isStackReady(stack);

    return {
      stackName: stack.StackName!,
      region: profileConfig.region || process.env.AWS_REGION || 'us-east-1',
      outputs,
      status: stack.StackStatus as any,
      readyForDeployment
    };
  }

  /**
   * Extract stack outputs
   */
  private extractOutputs(stack: Stack): Record<string, string> {
    const outputs: Record<string, string> = {};
    
    if (stack.Outputs) {
      for (const output of stack.Outputs) {
        if (output.OutputKey && output.OutputValue) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
    }

    return outputs;
  }

  /**
   * Check if stack is ready for application deployment
   */
  private isStackReady(stack: Stack): boolean {
    const readyStatuses = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE'
    ];

    return readyStatuses.includes(stack.StackStatus || '');
  }

  /**
   * Generate error recommendations based on error type
   */
  private generateErrorRecommendations(error: unknown): string[] {
    if (!error) return [];

    const errorMessage = error instanceof Error ? error.message : String(error);
    const recommendations: string[] = [];

    if (errorMessage.includes('AccessDenied') || errorMessage.includes('UnauthorizedOperation')) {
      recommendations.push(
        'Check that your AWS credentials have CloudFormation:DescribeStacks permission',
        'Verify the correct AWS profile is being used',
        'Ensure the stack exists in the correct AWS account'
      );
    } else if (errorMessage.includes('ValidationError')) {
      recommendations.push(
        'Verify the stack name is correct and exists',
        'Check that you are querying the correct AWS region',
        'Ensure the stack is not in a DELETE_COMPLETE state'
      );
    } else if (errorMessage.includes('does not exist')) {
      recommendations.push(
        'Create the stack first using CDK or CloudFormation',
        'Verify you are connected to the correct AWS account',
        'Check the correct region is specified'
      );
    } else {
      recommendations.push(
        'Check your internet connection',
        'Verify AWS credentials are configured',
        'Try again with a different AWS profile or region'
      );
    }

    return recommendations;
  }

  /**
   * Emit before stack inspection event
   */
  private emitBeforeInspectionEvent(stackName: string, config: AWSProfileConfig): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:before:stack-inspection'],
      {
        stackName,
        region: config.region,
        profile: config.profile
      },
      'S3StackInspector'
    );
  }

  /**
   * Emit after stack inspection event
   */
  private emitAfterInspectionEvent(stackName: string, requirements: StackRequirements): void {
    this.eventBus.emitEvent(
      EventTypes['serverless:after:stack-inspection'],
      {
        stackName,
        requirements,
        outputsCount: Object.keys(requirements.outputs).length,
        readyForDeployment: requirements.readyForDeployment
      },
      'S3StackInspector'
    );
  }

  /**
   * Emit stack inspection error event
   */
  private emitInspectionErrorEvent(stackName: string, error: string): void {
    this.eventBus.emitEvent(
      EventTypes['s3-sites:stack:inspection:failed'],
      {
        stackName,
        error
      },
      'S3StackInspector'
    );
  }
}