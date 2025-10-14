resource "aws_sqs_queue" "start_payment_queue" {
  name = "start_payment_queue"
}

resource "aws_sqs_queue" "check_balance_queue" {
  name = "check_balance_queue"
}

resource "aws_sqs_queue" "transaction_queue" {
  name = "transaction_queue"
}