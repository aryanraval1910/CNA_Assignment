variable "aws_region" {
  description = "AWS region where the infrastructure will be deployed."
  type        = string
  default     = "us-east-1"
}

variable "ami_id" {
  description = "Optional Ubuntu 24.04 AMI ID override for the selected AWS region."
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "Existing EC2 key pair name."
  type        = string
}

variable "project_name" {
  description = "Name used for AWS resource tags."
  type        = string
  default     = "logistics-control-tower"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH into the instance."
  type        = string
}

variable "allowed_http_cidr" {
  description = "CIDR allowed to access the application."
  type        = string
  default     = "0.0.0.0/0"
}

variable "allowed_egress_cidrs" {
  description = "Explicit destination CIDRs for required outbound HTTP, HTTPS, and DNS traffic. Use NAT or proxy CIDRs in production; do not use 0.0.0.0/0."
  type        = list(string)

  validation {
    condition     = length(var.allowed_egress_cidrs) > 0 && !contains(var.allowed_egress_cidrs, "0.0.0.0/0") && !contains(var.allowed_egress_cidrs, "::/0")
    error_message = "allowed_egress_cidrs must contain at least one destination and must not allow the entire internet."
  }
}

variable "repository_url" {
  description = "Git repository URL to deploy on the EC2 instance."
  type        = string
  default     = "https://github.com/aryanraval1910/CNA_Assignment.git"
}