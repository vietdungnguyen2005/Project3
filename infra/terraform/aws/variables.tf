variable "aws_profile" {
  description = "Local AWS CLI profile. Set to an empty string when CI supplies OIDC credentials."
  type        = string
  default     = "cv-portfolio"
}

variable "aws_region" {
  description = "AWS region allowed by the current evidence account."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "vpulse-evidence"
}

variable "environment" {
  type    = string
  default = "aws-evidence"
}

variable "expires_at" {
  description = "Human-readable teardown deadline applied to every supported resource."
  type        = string
}

variable "image_tag" {
  description = "Immutable Git SHA used as the backend image tag."
  type        = string
}

variable "desired_count" {
  description = "Use zero for the infrastructure bootstrap apply, then one after the image is pushed."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.desired_count)
    error_message = "Evidence mode supports a desired count of zero or one."
  }
}

variable "bff_shared_secret" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.bff_shared_secret) >= 32
    error_message = "The BFF shared secret must contain at least 32 characters."
  }
}

variable "ops_secret" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.ops_secret) >= 32 && var.ops_secret != var.bff_shared_secret
    error_message = "The operations secret must be distinct and contain at least 32 characters."
  }
}

variable "lab_role_name" {
  description = "Pre-created execution role supplied by AWS Academy."
  type        = string
  default     = "LabRole"
}
