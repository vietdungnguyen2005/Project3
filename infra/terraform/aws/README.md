# AWS evidence environment

This Terraform stack creates a short-lived, production-shaped V-Pulse backend in `us-east-1`:

- API Gateway HTTP API (public HTTPS edge) and an Application Load Balancer
- one ECS Fargate Spring Boot task built from an immutable Git SHA
- private, encrypted PostgreSQL on RDS and Redis on ElastiCache
- secrets in SSM Parameter Store
- ECR scan-on-push, CloudWatch logs, dashboard, and alarms

The AWS Academy account used for the recorded deployment blocks CloudFront, AWS Budgets, IAM identity-provider changes, and Tokyo-region workload APIs. API Gateway therefore provides HTTPS and proxies to the public ALB origin. The origin exposes only port 80; application routes still require the BFF credential, while RDS and Redis accept traffic only from the ECS task security group.

## Safety model

Every supported resource is tagged `ManagedBy=Terraform` and with an `ExpiresAt` deadline. Deploy environments sequentially and destroy them immediately after evidence collection. Terraform state contains generated credentials and must remain local and uncommitted; use an encrypted remote backend in a personal production account.

## Apply sequence

1. Copy `terraform.tfvars.example` to an ignored `terraform.tfvars` or supply the values with `TF_VAR_*` environment variables.
2. Apply with `desired_count=0` to create ECR and infrastructure.
3. Build `backend/Dockerfile` for `linux/amd64`, tag it with the full Git SHA, and push it to the output ECR repository.
4. Apply again with `desired_count=1`, wait for ECS stability, and verify the API Gateway output.
5. Capture sanitized evidence, run a destroy plan, and destroy the stack.

For normal CI/CD, replace the Academy `LabRole` and local profile with a least-privilege GitHub OIDC role. Static AWS access keys must never be stored in GitHub or committed to the repository.
