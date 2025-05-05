import json
import boto3
import os
from decimal import Decimal
from datetime import datetime

# Initialize DynamoDB
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("USER_TABLE", "User"))

def lambda_handler(event, context):
    method = event.get("httpMethod", "").upper()
    try:
        if method == "GET":
            params = event.get("queryStringParameters", {})
            if params and "email" in params:
                return get_user(event)
            else:
                return get_all_users(event)
        elif method == "POST":
            return create_user(event)
        elif method == "PUT" or method == "PATCH":
            return update_user(event)
        elif method == "DELETE":
            return delete_user(event)
        elif method == "DELETE" and event.get("queryStringParameters", {}).get("purge") == "true":
            return purge_users()
        else:
            return respond(405, {"error": f"Unsupported method: {method}"})
    except Exception as e:
        return respond(500, {"error": str(e)})

def get_user(event):
    params = event.get("queryStringParameters", {})
    email = params.get("email", "").strip().lower()

    if not email:
        return respond(400, {"error": "Missing 'email' in query params."})

    try:
        result = table.get_item(Key={"email": email})
        item = result.get("Item")
        if not item:
            return respond(404, {"error": f"User with email '{email}' not found."})
        return respond(200, item)
    except Exception as e:
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})
    
def get_all_users(event):
    try:
        result = table.scan()
        items = result.get("Items", [])

        # Remove Decimal issues for JSON serialization
        for item in items:
            if "createdAt" in item:
                item["createdAt"] = int(item["createdAt"])

        return respond(200, {"users": items})
    except Exception as e:
        return respond(500, {"error": f"DynamoDB scan error: {str(e)}"})  

def create_user(event):
    body = json.loads(event.get("body", "{}"))
    email = body.get("email", "").strip().lower()
    first_name = body.get("firstName", "").strip()
    last_name = body.get("lastName", "").strip()
    business = body.get("business", "").strip()
    promo = body.get("promo", "").strip()

    if not email or not first_name or not last_name or not business:
        return respond(400, {"error": "Missing required fields: 'email', 'firstName', 'lastName', 'business'."})

    try:
        record = {
            "email": email,
            "firstName": first_name,
            "lastName": last_name,
            "business": business,
            "promo": promo,
            "createdAt": int(datetime.utcnow().timestamp())
        }
        table.put_item(Item=record)
        return respond(201, {"message": "User created successfully.", "user": record})
    except Exception as e:
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})

def update_user(event):
    body = json.loads(event.get("body", "{}"))
    current_email = body.get("email", "").strip().lower()
    new_email = body.get("newEmail", "").strip().lower()  # New email if provided

    if not current_email:
        return respond(400, {"error": "Missing 'email' in request body."})

    update_fields = {}
    for key in ["firstName", "lastName", "business"]:
        if key in body:
            update_fields[key] = body[key].strip()

    if not update_fields and not new_email:
        return respond(400, {"error": "No update fields or newEmail provided."})

    try:
        # Fetch current item
        result = table.get_item(Key={"email": current_email})
        item = result.get("Item")
        if not item:
            return respond(404, {"error": f"User with email '{current_email}' not found."})

        # Update fields in memory
        item.update(update_fields)
        item["updatedAt"] = int(datetime.utcnow().timestamp())

        # If newEmail is provided, copy to new key and delete old
        if new_email:
            item["email"] = new_email
            table.put_item(Item=item)
            table.delete_item(Key={"email": current_email})
            return respond(200, {"message": f"Email updated to '{new_email}' and user updated.", "user": item})

        # If email isn't changing, just update in place
        update_expression = "SET " + ", ".join([f"{k} = :{k}" for k in update_fields])
        expression_values = {f":{k}": v for k, v in update_fields.items()}
        expression_values[":updatedAt"] = item["updatedAt"]
        update_expression += ", updatedAt = :updatedAt"

        table.update_item(
            Key={"email": current_email},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values
        )
        return respond(200, {"message": f"User with email '{current_email}' updated successfully.", "user": item})

    except Exception as e:
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})

def delete_user(event):
    params = event.get("queryStringParameters", {})
    email = params.get("email", "").strip().lower()

    if not email:
        return respond(400, {"error": "Missing 'email' in query params."})

    try:
        table.delete_item(Key={"email": email})
        return respond(200, {"message": f"User with email '{email}' deleted successfully."})
    except Exception as e:
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})

def purge_users():
    try:
        scan = table.scan()
        with table.batch_writer() as batch:
            for each in scan["Items"]:
                batch.delete_item(Key={"email": each["email"]})
        return respond(200, {"message": "All users deleted successfully."})
    except Exception as e:
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})

def respond(status, body):
    def decimal_default(obj):
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError

    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body, default=decimal_default)
    }