# This script is an AWS Lambda function that manages PowerPlays (Pinterest funnel sessions)
# indexed by user email in DynamoDB. It supports creation, retrieval, and incremental updates
# via dot-notation fields for precise, nested field patching.

import json
import boto3
import os
import uuid
from datetime import datetime
import decimal
from boto3.dynamodb.conditions import Key

# DynamoDB setup
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("POWERPLAY_TABLE", "Powerplays"))

def lambda_handler(event, context):
    method = event.get("httpMethod", "").upper()

    try:
        if method == "POST":
            return create_powerplay(event)
        elif method == "GET":
            return get_powerplays(event)
        elif method in ("PUT", "PATCH"):
            return update_powerplay(event)
        elif method == "DELETE":
            return delete_powerplays_by_email(event)
        else:
            return respond(405, {"error": f"Unsupported method: {method}"})
    except Exception as e:
        return respond(500, {"error": str(e)})


# POST: Create a new PowerPlay with a structured Pinterest schema
def create_powerplay(event):
    body = json.loads(event.get("body", "{}"))
    email = body.get("email", "").lower().strip()

    required = ["topic", "businessName", "style", "colors", "fonts", "websiteUrl", "hasBrand"]
    if not email:
        return respond(400, {"error": "Missing required field: email"})
    for key in required:
        if key not in body:
            return respond(400, {"error": f"Missing required field: {key}"})

    pinterest = {
        "niche": {f"niche{i}": "" for i in range(1, 6)},
        "affiliate": {f"product{i}": "" for i in range(1, 6)},
        "board": {f"board{i}": "" for i in range(1, 11)},
        "pins": {f"day{i}": [] for i in range(1, 32)}
    }

    item = {
        "id": str(uuid.uuid4()),
        "email": email,
        "createdAt": int(datetime.utcnow().timestamp()),
        "topic": body["topic"],
        "businessName": body["businessName"],
        "style": body["style"],
        "colors": body["colors"],
        "fonts": body["fonts"],
        "websiteUrl": body["websiteUrl"],
        "hasBrand": body["hasBrand"],
        "pinterest": pinterest
    }

    table.put_item(Item=item)
    return respond(201, {"message": "PowerPlay created", "data": item})

# PATCH/PUT: Update any nested field via dot-notation (e.g., pinterest.niche.niche3)
def update_powerplay(event):
    body = json.loads(event.get("body", "{}"))
    email = body.get("email", "").lower().strip()

    if not email:
        return respond(400, {"error": "Missing email"})

    update_expr_parts = []
    expr_vals = {}
    expr_names = {}
    updated_fields = []

    for key, value in body.items():
        if key in ("email", "method"):
            continue

        parts = key.split(".")
        expr_path = []
        for part in parts:
            name = part.replace("-", "_")
            placeholder = f"#{name}"
            expr_names[placeholder] = part
            expr_path.append(placeholder)

        value_key = f":v_{'_'.join(parts)}"
        expr_vals[value_key] = value
        update_expr_parts.append(f"{'.'.join(expr_path)} = {value_key}")
        updated_fields.append(key)

    update_expr_parts.append("lastUpdated = :lastUpdated")
    expr_vals[":lastUpdated"] = int(datetime.utcnow().timestamp())

    table.update_item(
        TableName=table.name,
        Key={"email": email},
        UpdateExpression="SET " + ", ".join(update_expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_vals
    )

    return respond(200, {
        "message": "PowerPlay updated",
        "updated_fields": updated_fields
    })

# GET: Retrieve all PowerPlays for a given user by email
def get_powerplays(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    result = table.query(
        IndexName="email-index",
        KeyConditionExpression=Key("email").eq(email)
    )
    return respond(200, {"powerplays": result.get("Items", [])})

# DELETE: Remove all PowerPlays for a given user by email
def delete_powerplays_by_email(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    result = table.query(
        IndexName="email-index",
        KeyConditionExpression=Key("email").eq(email)
    )
    items = result.get("Items", [])

    for item in items:
        table.delete_item(Key={
            "email": item["email"]
        })

    return respond(200, {
        "message": f"Deleted {len(items)} PowerPlay record(s) for email: {email}"
    })


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body, default=decimal_default)
    }


# Utility Functions
def decimal_default(obj):
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    raise TypeError