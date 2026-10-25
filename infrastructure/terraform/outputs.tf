output "instance_id" {
  description = "ID of the EC2 instance running the application."
  value       = aws_instance.application.id
}

output "instance_public_ip" {
  description = "Public IPv4 address of the application instance."
  value       = aws_instance.application.public_ip
}

output "frontend_url" {
  description = "URL of the frontend dashboard."
  value       = "http://${aws_instance.application.public_ip}:3000"
}

output "rabbitmq_management_url" {
  description = "URL of the RabbitMQ management interface."
  value       = "http://${aws_instance.application.public_ip}:15672"
}