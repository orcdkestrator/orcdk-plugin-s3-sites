# S3 Sites Plugin Examples

## Basic Static Site

```json
{
  "plugins": {
    "@orcdkestrator/s3-sites": {
      "enabled": true,
      "config": {
        "sites": [
          {
            "name": "my-website",
            "source": "./dist",
            "bucketName": "my-website-bucket"
          }
        ]
      }
    }
  }
}
```

## With CloudFront Invalidation

```json
{
  "plugins": {
    "@orcdkestrator/s3-sites": {
      "enabled": true,
      "config": {
        "sites": [
          {
            "name": "production-site",
            "source": "./build",
            "bucketName": "prod-website-bucket",
            "distributionId": "E1234567890ABC",
            "invalidate": true,
            "deleteBeforeUpload": true
          }
        ]
      }
    }
  }
}
```

## With Cache Control

```json
{
  "plugins": {
    "@orcdkestrator/s3-sites": {
      "enabled": true,
      "config": {
        "sites": [
          {
            "name": "optimized-site",
            "source": "./public",
            "bucketName": "optimized-website",
            "distributionId": "E0987654321XYZ",
            "invalidate": true,
            "cacheControl": {
              "*.html": "max-age=0, must-revalidate",
              "*.js": "max-age=31536000, immutable",
              "*.css": "max-age=31536000, immutable",
              "images/*": "max-age=86400"
            }
          }
        ]
      }
    }
  }
}
```

## Remote Stack Deployment

```json
{
  "plugins": {
    "@orcdkestrator/s3-sites": {
      "enabled": true,
      "config": {
        "enableRemoteDeployment": true,
        "sites": [
          {
            "name": "remote-site",
            "source": "./dist",
            "stackName": "MyWebsiteStack"
          }
        ]
      }
    }
  }
}
```

## Multiple Sites

```json
{
  "plugins": {
    "@orcdkestrator/s3-sites": {
      "enabled": true,
      "config": {
        "sites": [
          {
            "name": "main-site",
            "source": "./dist/main",
            "bucketName": "main-website"
          },
          {
            "name": "docs-site",
            "source": "./dist/docs",
            "bucketName": "docs-website"
          },
          {
            "name": "blog-site",
            "source": "./dist/blog",
            "bucketName": "blog-website"
          }
        ]
      }
    }
  }
}
```
