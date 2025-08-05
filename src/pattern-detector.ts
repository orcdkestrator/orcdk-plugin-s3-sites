import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'fast-glob';
import { EventBus, EventTypes } from '@orcdkestrator/core';
import { S3SitePattern, S3Site, PackageJsonSite } from './types';

/**
 * Detects S3 static sites in a project
 * Follows the same patterns as ServerlessPatternDetector
 */
export class S3SitePatternDetector {
  private readonly projectRoot: string;
  private readonly eventBus: EventBus;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Scan for S3 static sites
   */
  async scan(): Promise<S3SitePattern> {
    this.emitBeforeEvent();
    
    const sites = await this.detectSites();
    
    const pattern: S3SitePattern = {
      type: 's3-sites',
      sites
    };
    
    this.emitAfterEvent(pattern);
    return pattern;
  }

  /**
   * Detect static sites in the project
   */
  private async detectSites(): Promise<S3Site[]> {
    const sites: S3Site[] = [];
    
    // Detection strategy 1: Look for common static site patterns
    const staticSitePatterns = await this.detectByStaticSitePatterns();
    sites.push(...staticSitePatterns);
    
    // Detection strategy 2: Look for package.json with build scripts
    const packageJsonSites = await this.detectByPackageJson();
    sites.push(...packageJsonSites);
    
    // Detection strategy 3: Look for common frameworks
    const frameworkSites = await this.detectByFrameworks();
    sites.push(...frameworkSites);
    
    // Remove duplicates based on path
    const uniqueSites = this.deduplicateSites(sites);
    
    return uniqueSites;
  }

  /**
   * Detect sites by static site patterns (dist/, build/, public/)
   */
  private async detectByStaticSitePatterns(): Promise<S3Site[]> {
    const sites: S3Site[] = [];
    
    const distPatterns = [
      'dist/',
      'build/',
      'public/',
      'out/',
      '_site/',
      'www/'
    ];
    
    for (const distPattern of distPatterns) {
      const distPaths = await this.glob([distPattern], {
        cwd: this.projectRoot,
        onlyDirectories: true,
        absolute: true,
        ignore: ['**/node_modules/**']
      });
      
      for (const distPath of distPaths) {
        // Check if this directory contains web assets
        if (await this.containsWebAssets(distPath)) {
          const sitePath = path.dirname(distPath);
          const siteName = path.basename(sitePath) || 'static-site';
          
          sites.push({
            name: siteName,
            path: sitePath,
            distDirectory: path.relative(sitePath, distPath),
            dependencies: []
          });
        }
      }
    }
    
    return sites;
  }

  /**
   * Detect sites by package.json with build scripts
   */
  private async detectByPackageJson(): Promise<S3Site[]> {
    const sites: S3Site[] = [];
    
    const packageJsonFiles = await this.glob(['**/package.json'], {
      cwd: this.projectRoot,
      absolute: true,
      ignore: ['**/node_modules/**']
    });
    
    for (const packageFile of packageJsonFiles) {
      try {
        const packageJson = await this.loadPackageJson(packageFile);
        
        if (this.isStaticSitePackage(packageJson)) {
          const sitePath = path.dirname(packageFile);
          const distDirectory = this.inferDistDirectory(packageJson, sitePath);
          
          sites.push({
            name: packageJson.name || path.basename(sitePath),
            path: sitePath,
            distDirectory,
            dependencies: []
          });
        }
      } catch (error) {
        // Skip invalid package.json files
        continue;
      }
    }
    
    return sites;
  }

  /**
   * Detect sites by common frameworks
   */
  private async detectByFrameworks(): Promise<S3Site[]> {
    const sites: S3Site[] = [];
    
    const frameworkConfigs = [
      { files: ['next.config.js', 'next.config.mjs', 'next.config.ts'], dist: 'out', name: 'nextjs' },
      { files: ['nuxt.config.js', 'nuxt.config.ts'], dist: 'dist', name: 'nuxtjs' },
      { files: ['vite.config.js', 'vite.config.ts'], dist: 'dist', name: 'vite' },
      { files: ['vue.config.js'], dist: 'dist', name: 'vue' },
      { files: ['angular.json'], dist: 'dist', name: 'angular' },
      { files: ['gatsby-config.js', 'gatsby-config.ts'], dist: 'public', name: 'gatsby' },
      { files: ['svelte.config.js'], dist: 'build', name: 'svelte' },
      { files: ['_config.yml'], dist: '_site', name: 'jekyll' },
      { files: ['config.toml', 'config.yaml', 'hugo.toml'], dist: 'public', name: 'hugo' }
    ];
    
    for (const framework of frameworkConfigs) {
      for (const configFile of framework.files) {
        const configPaths = await this.glob([`**/${configFile}`], {
          cwd: this.projectRoot,
          absolute: true,
          ignore: ['**/node_modules/**']
        });
        
        for (const configPath of configPaths) {
          const sitePath = path.dirname(configPath);
          const siteName = `${framework.name}-${path.basename(sitePath)}`;
          
          sites.push({
            name: siteName,
            path: sitePath,
            distDirectory: framework.dist,
            dependencies: []
          });
        }
      }
    }
    
    return sites;
  }

  /**
   * Check if directory contains web assets
   */
  private async containsWebAssets(dirPath: string): Promise<boolean> {
    try {
      const files = await fs.promises.readdir(dirPath);
      const webAssetExtensions = ['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'];
      
      return files.some(file => 
        webAssetExtensions.some(ext => file.toLowerCase().endsWith(ext))
      );
    } catch {
      return false;
    }
  }

  /**
   * Load and parse package.json
   */
  private async loadPackageJson(packageFile: string): Promise<PackageJsonSite> {
    // Validate path is within project boundaries
    if (!this.isPathSafe(packageFile)) {
      throw new Error(`Invalid path: ${packageFile} is outside project boundaries`);
    }
    
    // Check file size to prevent DoS attacks
    const stats = await fs.promises.stat(packageFile);
    const maxFileSizeMB = 1;
    const maxFileSize = maxFileSizeMB * 1024 * 1024; // 1MB limit
    
    if (stats.size > maxFileSize) {
      throw new Error(`File ${packageFile} exceeds maximum size limit of ${maxFileSizeMB}MB`);
    }
    
    const content = await fs.promises.readFile(packageFile, 'utf-8');
    return JSON.parse(content) as PackageJsonSite;
  }

  /**
   * Check if package.json indicates a static site
   */
  private isStaticSitePackage(packageJson: PackageJsonSite): boolean {
    const scripts = packageJson.scripts || {};
    
    // Check for build scripts
    const buildScripts = ['build', 'build:prod', 'build:production', 'generate', 'export'];
    const hasBuildScript = buildScripts.some(script => scripts[script]);
    
    // Check for common static site dependencies or scripts
    const staticSiteIndicators = [
      'react-scripts build',
      'vue-cli-service build',
      'ng build',
      'next build && next export',
      'nuxt generate',
      'gatsby build',
      'vite build',
      'svelte-kit build'
    ];
    
    const hasStaticSiteScript = Object.values(scripts).some(script => 
      script && staticSiteIndicators.some(indicator => script.includes(indicator))
    );
    
    return hasBuildScript || hasStaticSiteScript || !!packageJson.homepage;
  }

  /**
   * Infer the dist directory from package.json
   */
  private inferDistDirectory(packageJson: PackageJsonSite, sitePath: string): string {
    // Common dist directory patterns
    const commonDistDirs = ['dist', 'build', 'out', 'public', '_site', 'www'];
    
    // Check if any of the common directories exist
    for (const distDir of commonDistDirs) {
      const fullPath = path.join(sitePath, distDir);
      if (fs.existsSync(fullPath)) {
        return distDir;
      }
    }
    
    // Default to 'dist'
    return 'dist';
  }

  /**
   * Remove duplicate sites based on path
   */
  private deduplicateSites(sites: S3Site[]): S3Site[] {
    const seenPaths = new Set<string>();
    const uniqueSites: S3Site[] = [];
    
    for (const site of sites) {
      const normalizedPath = path.resolve(site.path);
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        uniqueSites.push(site);
      }
    }
    
    return uniqueSites;
  }

  /**
   * Emit before pattern detection event
   */
  private emitBeforeEvent(): void {
    this.eventBus.emitEvent(
      EventTypes['s3-sites:before:pattern-detection'],
      { projectRoot: this.projectRoot },
      'S3SitePatternDetector'
    );
  }

  /**
   * Emit after pattern detection event
   */
  private emitAfterEvent(pattern: S3SitePattern): void {
    this.eventBus.emitEvent(
      EventTypes['s3-sites:after:pattern-detection'],
      {
        pattern,
        sitesFound: pattern.sites.length,
        sites: pattern.sites.map(s => s.name)
      },
      'S3SitePatternDetector'
    );
  }

  /**
   * Wrapper for glob to enable testing
   */
  private async glob(patterns: string[], options: { cwd: string; ignore?: string[]; absolute?: boolean; onlyDirectories?: boolean }): Promise<string[]> {
    return glob(patterns, options);
  }

  /**
   * Validate that a path is within project boundaries
   */
  private isPathSafe(filePath: string): boolean {
    try {
      const resolvedPath = path.resolve(filePath);
      const baseDir = path.resolve(this.projectRoot);
      
      // Check if the resolved path starts with the base directory
      return resolvedPath.startsWith(baseDir);
    } catch {
      return false;
    }
  }
}