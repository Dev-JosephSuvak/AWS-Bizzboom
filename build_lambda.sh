#!/bin/bash
set -e

# --- Validate input ---
if [ -z "$1" ]; then
  echo "Usage: ./build_lambda.sh ./PythonConnectors/<source_file.py>"
  exit 1
fi

SOURCE_FILE="$1"
HANDLER_NAME=$(basename "$SOURCE_FILE")
HANDLER_DIR=$(dirname "$SOURCE_FILE")

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Error: $SOURCE_FILE not found."
  exit 2
fi

# --- Clean previous build ---
rm -rf python package lambda.zip

# --- Build in Docker to match AWS Lambda environment ---
docker run --rm -v "$PWD":/var/task -w /var/task amazonlinux:2023 /bin/bash -c "
  yum install -y python3-pip zip gcc &&
  python3 -m venv venv &&
  source venv/bin/activate &&
  pip install --upgrade pip &&
  pip install \
    --platform manylinux2014_x86_64 \
    --target=package \
    --implementation cp \
    --python-version 3.12 \
    --only-binary=:all: \
    -r requirements.txt &&
  mkdir -p python &&
  cp -r package/* python/
"

# --- Copy and rename handler file ---
cp "$SOURCE_FILE" python/lambda_function.py

# --- Zip it up for AWS ---
cd python
zip -r9 ../lambda.zip .
cd ..

echo "✅ Lambda zip built successfully: lambda.zip"
