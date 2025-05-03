# This script is an AWS Lambda function that manages membership data
#  (across all platforms; for reporting and validation of permissions) in a DynamoDB table.

import json
import boto3
import os
from datetime import datetime

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("MEMBERSHIP_TABLE", "Memberships"))

def lambda_handler(event, context):
    method = event.get("httpMethod", "").upper()
    try:
        if method == "POST":
            return create_membership(event)
        elif method == "GET":
            return get_membership(event)
        elif method in ("PUT", "PATCH"):
            return update_membership(event)
        elif method == "DELETE":
            return delete_membership(event)
        else:
            return respond(405, {"error": f"Unsupported method: {method}"})
    except Exception as e:
        return respond(500, {"error": str(e)})

# POST: Create a membership
def create_membership(event):
    body = json.loads(event.get("body", "{}"))
    required = [
        "email", "gptLimit", "gptCount",
        "subscription_start", "subscription_end",
        "tier", "payment_freq"
    ]
    if not all(k in body for k in required):
        return respond(400, {"error": f"Missing required fields: {required}"})

    email = body["email"].lower().strip()

    existing = table.get_item(Key={"email": email}).get("Item")
    if existing:
        return respond(409, {"error": "Membership already exists"})

    item = {
        "email": email,
        "gptLimit": int(body["gptLimit"]),
        "gptCount": int(body["gptCount"]),
        "subscription_start": int(body["subscription_start"]),
        "subscription_end": int(body["subscription_end"]),
        "tier": body["tier"],
        "payment_freq": body["payment_freq"],
        "lastUpdated": int(datetime.utcnow().timestamp())
    }

    table.put_item(Item=item)
    return respond(201, {"message": "Membership created", "data": item})

# GET: Retrieve membership
def get_membership(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    result = table.get_item(Key={"email": email})
    item = result.get("Item")
    if not item:
        return respond(404, {"error": "Membership not found"})

    return respond(200, item)

# PUT/PATCH: Update membership
def update_membership(event):
    body = json.loads(event.get("body", "{}"))
    email = body.get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email field"})

    updatable_fields = [
        "gptLimit", "gptCount", "subscription_start",
        "subscription_end", "tier", "payment_freq"
    ]
    update_fields = {k: body[k] for k in updatable_fields if k in body}

    if not update_fields:
        return respond(400, {"error": "No updatable fields provided"})

    update_expr = "SET " + ", ".join(f"{k}=:{k}" for k in update_fields)
    update_expr += ", lastUpdated = :lastUpdated"

    expr_vals = {f":{k}": v for k, v in update_fields.items()}
    expr_vals[":lastUpdated"] = int(datetime.utcnow().timestamp())

    table.update_item(
        Key={"email": email},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_vals
    )

    return respond(200, {"message": "Membership updated", "fields": list(update_fields.keys())})

# DELETE: Remove membership
def delete_membership(event):
    email = event.get("queryStringParameters", {}).get("email", "").lower().strip()
    if not email:
        return respond(400, {"error": "Missing email query parameter"})

    table.delete_item(Key={"email": email})
    return respond(200, {"message": "Membership deleted", "email": email})

# Utility response wrapper
def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body)
    }
