# AWS Lambda function to interact with OpenAI's GPT-3.5-turbo model & the storing/retreival results in DynamoDB


import json
import boto3
import os
from datetime import datetime
import openai

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("GPT_TABLE", "GPT_Transactions"))
openai.api_key = os.environ.get("OPENAI_API_KEY")

def lambda_handler(event, context):
    method = event.get("httpMethod", "").upper()
    try:
        if method == "GET":
            return get_or_generate(event)
        else:
            return respond(405, {"error": f"Unsupported method: {method}"})
    except Exception as e:
        return respond(500, {"error": str(e)})

def get_or_generate(event):
    params = event.get("queryStringParameters", {})
    keyword = params.get("keyword", "").strip().lower()
    promo = params.get("promo", "").strip()
    gpt_input = params.get("gptInput", "").strip()

    if not keyword or not gpt_input:
        return respond(400, {"error": "Missing 'keyword' or 'gptInput' in query params."})

    # Check if already exists
    result = table.get_item(Key={"prompt": keyword})
    item = result.get("Item")
    if item:
        return respond(200, item)

    # Otherwise call OpenAI
    try:
        gpt_result = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            temperature=0.7,
            messages=[{"role": "user", "content": gpt_input}]
        )

        message = gpt_result.choices[0].message.content.strip()
        parsed = json.loads(message)

        record = {
            "prompt": keyword,
            "response": parsed,
            "promo": promo,
            "keyword": keyword,
            "gptInput": gpt_input,
            "createdAt": int(datetime.utcnow().timestamp())
        }

        table.put_item(Item=record)
        return respond(200, record)

    except Exception as e:
        return respond(502, {"error": f"OpenAI error: {str(e)}"})

def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body)
    }
