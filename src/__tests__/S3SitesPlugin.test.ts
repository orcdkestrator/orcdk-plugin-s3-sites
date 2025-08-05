import { S3SitesPlugin } from '../index';

describe('S3SitesPlugin', () => {
  it('should be defined', () => {
    expect(S3SitesPlugin).toBeDefined();
  });

  it('should have correct name', () => {
    const plugin = new S3SitesPlugin();
    expect(plugin.name).toBe('s3-sites');
  });
});
