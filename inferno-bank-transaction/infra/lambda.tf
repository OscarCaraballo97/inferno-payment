resource "aws_lambda_function" "api_gateway_lambda" {
  function_name = "payment-api-handler"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")


  environment {
    variables = {
      DYNAMODB_TABLE_NAME     = aws_dynamodb_table.transaction_table.name
      START_PAYMENT_QUEUE_URL = aws_sqs_queue.start_payment_queue.id
      USER_SERVICE_API        = "URL_DEL_MICROSERVICIO_DE_USUARIOS" 
      CATALOG_BUCKET_NAME     = aws_s3_bucket.catalog_bucket.id
      CATALOG_REDIS_KEY       = "service_catalog"
      # REDIS_ENDPOINT        = "" # Descomentar cuando se tenga Redis
      # REDIS_PORT            = 
    }
  }
}


resource "aws_lambda_function" "start_payment_worker" {
  function_name = "start-payment-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")


  environment {
    variables = {
      LAMBDA_TASK               = "START_PAYMENT"
      DYNAMODB_TABLE_NAME       = aws_dynamodb_table.transaction_table.name
      CHECK_BALANCE_QUEUE_URL   = aws_sqs_queue.check_balance_queue.id
    }
  }
}


resource "aws_lambda_function" "check_balance_worker" {
  function_name = "check-balance-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      LAMBDA_TASK           = "CHECK_BALANCE"
      DYNAMODB_TABLE_NAME   = aws_dynamodb_table.transaction_table.name
      TRANSACTION_QUEUE_URL = aws_sqs_queue.transaction_queue.id
    }
  }
}

resource "aws_lambda_function" "transaction_worker" {
  function_name = "transaction-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30

  filename         = "../app/deployment_package.zip"
  source_code_hash = filebase64sha256("../app/deployment_package.zip")

  environment {
    variables = {
      LAMBDA_TASK         = "TRANSACTION"
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.transaction_table.name
      CORE_BANKING_API    = "URL_DEL_CORE_BANCARIO" # reemplazar esto al desplegar
    }
  }
}


resource "aws_lambda_event_source_mapping" "start_payment_mapping" {
  event_source_arn = aws_sqs_queue.start_payment_queue.arn
  function_name    = aws_lambda_function.start_payment_worker.arn
}

resource "aws_lambda_event_source_mapping" "check_balance_mapping" {
  event_source_arn = aws_sqs_queue.check_balance_queue.arn
  function_name    = aws_lambda_function.check_balance_worker.arn
}

resource "aws_lambda_event_source_mapping" "transaction_mapping" {
  event_source_arn = aws_sqs_queue.transaction_queue.arn
  function_name    = aws_lambda_function.transaction_worker.arn
}