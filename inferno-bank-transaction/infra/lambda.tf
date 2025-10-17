variable "user_service_api_base" {
  description = "Base URL del microservicio de users (GET /cards/{card_id})"
  type        = string
  default     = "https://lyvbzyt7p9.execute-api.us-east-1.amazonaws.com/dev"
}

variable "core_banking_base_url" {
  description = "Base URL del core bancario (users/{userId}/transactions)"
  type        = string
  default     = "https://0o5atpc8xb.execute-api.us-east-1.amazonaws.com/dev"
}

resource "aws_lambda_function" "api_gateway_lambda" {
  function_name = "payment-api-handler"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  architectures = ["x86_64"]
  timeout       = 30
  memory_size   = 256

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      DYNAMODB_TABLE_NAME     = aws_dynamodb_table.transaction_table.name
      START_PAYMENT_QUEUE_URL = aws_sqs_queue.start_payment_queue.id

      # 👇 PON AQUÍ LA BASE REAL (o usa var.user_service_api_base):
      USER_SERVICE_API        = var.user_service_api_base

      # Catálogo (opcional, para tu /catalog)
      CATALOG_BUCKET_NAME     = aws_s3_bucket.catalog_bucket.id
      CATALOG_REDIS_KEY       = "service_catalog"
      # REDIS_ENDPOINT        = "aun-no-configurado"
      # REDIS_PORT           = "6379"
    }
  }

  # (Opcional) una descripción útil
  description = "API Lambda para iniciar pagos y consultar estado (payments)"
}

resource "aws_lambda_function" "start_payment_worker" {
  function_name = "start-payment-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  architectures = ["x86_64"]
  timeout       = 30
  memory_size   = 256

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      LAMBDA_TASK             = "START_PAYMENT"
      DYNAMODB_TABLE_NAME     = aws_dynamodb_table.transaction_table.name
      CHECK_BALANCE_QUEUE_URL = aws_sqs_queue.check_balance_queue.id
    }
  }

  description = "Worker SQS: persiste INITIAL y encola a CHECK_BALANCE"
}

resource "aws_lambda_function" "check_balance_worker" {
  function_name = "check-balance-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  architectures = ["x86_64"]
  timeout       = 30
  memory_size   = 256

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      LAMBDA_TASK           = "CHECK_BALANCE"
      DYNAMODB_TABLE_NAME   = aws_dynamodb_table.transaction_table.name
      TRANSACTION_QUEUE_URL = aws_sqs_queue.transaction_queue.id
    }
  }

  description = "Worker SQS: valida saldo y encola a TRANSACTION"
}

resource "aws_lambda_function" "transaction_worker" {
  function_name = "transaction-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  architectures = ["x86_64"]
  timeout       = 30
  memory_size   = 256

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      LAMBDA_TASK         = "TRANSACTION"
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.transaction_table.name
      CORE_BANKING_BASE   = var.core_banking_base_url
    }
  }

  description = "Worker SQS: ejecuta débito y llama al core bancario"
}

resource "aws_lambda_event_source_mapping" "start_payment_mapping" {
  event_source_arn = aws_sqs_queue.start_payment_queue.arn
  function_name    = aws_lambda_function.start_payment_worker.arn
  # (Opcional) ajustes:
  # batch_size     = 1
  # enabled        = true
}

resource "aws_lambda_event_source_mapping" "check_balance_mapping" {
  event_source_arn = aws_sqs_queue.check_balance_queue.arn
  function_name    = aws_lambda_function.check_balance_worker.arn
  # batch_size     = 1
  # enabled        = true
}

resource "aws_lambda_event_source_mapping" "transaction_mapping" {
  event_source_arn = aws_sqs_queue.transaction_queue.arn
  function_name    = aws_lambda_function.transaction_worker.arn
  # batch_size     = 1
  # enabled        = true
}
