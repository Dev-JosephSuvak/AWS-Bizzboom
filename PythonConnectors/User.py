# This script is an AWS Lambda function that interacts with a DynamoDB table to manage user data for management of contacts for a membership.

import json
import boto3
import os
from datetime import datetime

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("CONTACTS_TABLE", "User"))  # default table name

def lambda_handler(event, context):
    method = event.get("httpMethod", "").upper()
    try:
        if method == "POST":
            return create_user(event)
        elif method == "GET":
            return get_user(event)
        elif method in ("PUT", "PATCH"):
            return update_user(event)
        elif method == "DELETE":
            return delete_user(event)
        else:
            return respond(405, {"error": f"Unsupported method: {method}"})
    except Exception as e:
        return respond(500, {"error": str(e)})

# POST: Create user
def create_user(event):
    body = json.loads(event.get("body", "{}"))
    required = ["email", "firstName", "lastName", "business", "interest"]
    if not all(k in body for k in required):
        return respond(400, {"error": f"Missing required fields: {required}"})

    email = body["email"].lower().strip()

    existing = table.get_item(Key={"email": email}).get("Item")
    if existing:
        return respond(409, {"error": "User already exists"})

    item = {
        "email": email,
        "firstName": body["firstName"],
        "lastName": body["lastName"],
        "business": body["business"],
        "interest": body["interest"],
        "createdAt": datetime.utcnow().isoformat()
    }

    table.put_item(Item=item)
    return respond(201, {"message": "User created", "data": item})

# GET: Retrieve user
def get_user(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    result = table.get_item(Key={"email": email})
    item = result.get("Item")

    if not item:
        return respond(404, {"error": "User not found"})

    return respond(200, item)

# PUT/PATCH: Update user
def update_user(event):
    body = json.loads(event.get("body", "{}"))
    email = body.get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email field"})

    updatable_fields = ["firstName", "lastName", "business", "interest"]
    update_fields = {k: v for k, v in body.items() if k in updatable_fields}

    if not update_fields:
        return respond(400, {"error": "No updatable fields provided"})

    update_expr = "SET " + ", ".join(f"{k} = :{k}" for k in update_fields)
    expr_vals = {f":{k}": v for k, v in update_fields.items()}

    table.update_item(
        Key={"email": email},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_vals
    )

    return respond(200, {"message": "User updated", "fields": list(update_fields.keys())})

# DELETE: Remove user
def delete_user(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    table.delete_item(Key={"email": email})
    return respond(200, {"message": "User deleted", "email": email})

# Response utility
def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body)
    }
