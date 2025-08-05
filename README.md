# Orcdkestrator Plugin: S3 Sites

S3 static site deployment plugin with CloudFront integration for Orcdkestrator

## Installation

```bash
npm install @orcdkestrator/orcdk-plugin-s3-sites --save-dev
```

## Configuration

Add to your `orcdk.config.json`:

```json
{
  "plugins": [
    {
      "name": "s3-sites",
      "enabled": true,
      "config": {
        // Plugin-specific configuration
      }
    }
  ]
}
```

## Usage

See configuration section above and examples directory for detailed usage.

## API Reference

See [API Documentation](docs/api.md) for detailed information.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| enabled | boolean | true | Enable/disable the plugin |



## How It Works

The plugin detects S3 static site patterns in your CDK code and handles deployment, synchronization, and CloudFront invalidation.

## Examples

See the [examples directory](docs/examples/) for complete examples.

## Development

```bash
# Clone the repository
git clone https://github.com/orcdkestrator/orcdk-plugin-s3-sites.git

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.
