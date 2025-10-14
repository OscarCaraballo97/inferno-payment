resource "aws_s3_bucket" "catalog_bucket" {
  # El nombre del bucket debe ser único a nivel mundial.
  # Si falla la creación, añade números aleatorios al final.
  bucket = "inferno-payment-catalog-uploads"
}

# Recurso separado para gestionar el versionado
resource "aws_s3_bucket_versioning" "catalog_bucket_versioning" {
  bucket = aws_s3_bucket.catalog_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Recurso separado para gestionar la encriptación
resource "aws_s3_bucket_server_side_encryption_configuration" "catalog_bucket_encryption" {
  bucket = aws_s3_bucket.catalog_bucket.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}