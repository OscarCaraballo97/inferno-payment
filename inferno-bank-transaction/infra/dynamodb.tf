resource "aws_dynamodb_table" "transaction_table" {
  name           = "inferno-bank-transaction-table"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "traceId"

  attribute {
    name = "traceId"
    type = "S"
  }
}