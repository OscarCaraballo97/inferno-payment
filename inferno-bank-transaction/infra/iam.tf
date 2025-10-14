resource "aws_iam_role" "lambda_exec_role" {
  name = "lambda_payment_execution_role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17",
    Statement = [{
      Action    = "sts:AssumeRole",
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "lambda_custom_policy" {
  name   = "lambda_payment_custom_policy"
  policy = jsonencode({
    Version   = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem"],
        Resource = aws_dynamodb_table.transaction_table.arn
      },
      {
        Effect   = "Allow",
        Action   = ["s3:PutObject"],
        Resource = "${aws_s3_bucket.catalog_bucket.arn}/*"
      },
      {
        Effect   = "Allow",
        Action   = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ],
        Resource = [
          aws_s_queue.start_payment_queue.arn,
          aws_sqs_queue.check_balance_queue.arn,
          aws_sqs_queue.transaction_queue.arn
        ]
      },
      {
        Effect   = "Allow",
        Action   = "sqs:SendMessage",
        Resource = [
          aws_sqs_queue.start_payment_queue.arn,
          aws_sqs_queue.check_balance_queue.arn,
          aws_sqs_queue.transaction_queue.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_custom_policy_attachment" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = aws_iam_policy.lambda_custom_policy.arn
}