output "api_gateway_url" {
  description = "The base URL for the Payment API Gateway stage"
  value       = aws_api_gateway_stage.api_stage.invoke_url
}