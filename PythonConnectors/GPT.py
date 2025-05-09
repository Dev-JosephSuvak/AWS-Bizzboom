# AWS Lambda function to interact with OpenAI's GPT-3.5-turbo model & the storing/retreival results in DynamoDB

import json
import boto3
import os
from datetime import datetime
from decimal import Decimal
from openai import OpenAI
import logging

# --- Set up logging ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Setup AWS and OpenAI ---
dynamodb = boto3.resource("dynamodb")
table_name = os.environ.get("GPT_TABLE", "GPT_Transactions")
table = dynamodb.Table(table_name)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


def lambda_handler(event, context):
    logger.info(f"🚀 Received event: {json.dumps(event)}")

    method = event.get("httpMethod", "").upper()
    query = event.get("queryStringParameters", {}) or {}

    try:
        if method == "GET":
            if query.get("purge") == "true":
                auth_token = query.get("auth", "")
                if auth_token == os.environ.get("PURGE_KEY"):
                    purge_table()
                    return respond(200, {"message": "GPT_Transactions purged."})
                else:
                    return respond(403, {"error": "Unauthorized purge attempt."})

            if query.get("mode") == "list":
                return list_gpt_entries()

            return get_or_generate(event)

        elif method == "POST":
            body = json.loads(event.get("body", "{}"))
            if body.get("mode") == "chat":
                return chat_direct(body)
            return generate_and_store(event)

        else:
            logger.warning(f"❌ Unsupported HTTP method: {method}")
            return respond(405, {"error": f"Unsupported method: {method}"})

    except Exception as e:
        logger.exception("🔥 Unhandled exception in lambda_handler")
        return respond(500, {"error": str(e)})



def get_or_generate(event):
    params = event.get("queryStringParameters", {}) or {}
    keyword = params.get("keyword", "").strip().lower()
    promo = params.get("promo", "").strip()
    gpt_input = params.get("gptInput", "").strip()
    cache_only = params.get("cacheOnly", "false").lower() == "true"

    logger.info(f"🔍 Parameters extracted — keyword: '{keyword}', promo: '{promo}', cacheOnly: {cache_only}")

    if not keyword:
        logger.warning("⚠️ Missing 'keyword'")
        return respond(400, {"error": "Missing 'keyword' in query params."})

    # --- Check DynamoDB Cache ---
    try:
        result = table.get_item(Key={"GPT": keyword})
        item = result.get("Item")
        if item:
            logger.info(f"✅ Cache hit for keyword: {keyword}")
            return respond(200, item)
        elif cache_only:
            logger.info("🚫 Cache miss and 'cacheOnly' is true — skipping OpenAI")
            return respond(404, {"error": "No cache entry for this keyword"})
        logger.info(f"📭 Cache miss — proceeding to OpenAI with input: {gpt_input}")
    except Exception as e:
        logger.exception("🛑 DynamoDB query failed")
        return respond(500, {"error": f"DynamoDB error: {str(e)}"})

    # --- Fallback to OpenAI (if not cacheOnly) ---
    if not gpt_input:
        logger.warning("⚠️ Missing 'gptInput' for OpenAI fallback")
        return respond(400, {"error": "Missing 'gptInput' for OpenAI fallback"})

    try:
        gpt_result = client.chat.completions.create(
            model="gpt-3.5-turbo",
            temperature=0.7,
            messages=[{"role": "user", "content": gpt_input}]
        )
        logger.info(f"📤 OpenAI Payload: {json.dumps(gpt_result, indent=2)}") 

        message = normalize_gpt_response(gpt_result.choices[0].message.content.strip())

        logger.info(f"🤖 OpenAI response received: {message[:200]}...")

        record = {
            "GPT": keyword,
            "response": message,
            "promo": promo,
            "keyword": keyword,
            "prompt": gpt_input,
            "createdAt": int(datetime.utcnow().timestamp())
        }

        table.put_item(Item=record)
        logger.info(f"💾 Stored OpenAI response in DynamoDB under key: {keyword}")
        return respond(200, record)

    except Exception as e:
        logger.exception("🧠 OpenAI request failed")
        return respond(502, {"error": f"OpenAI error: {str(e)}", "request": gpt_input})

def generate_and_store(event):
    body = json.loads(event.get("body", "{}"))
    keyword = body.get("keyword", "").strip().lower()
    promo = body.get("promo", "").strip()
    gpt_prompt = body.get("prompt", "").strip()  # 👈 Pull the actual prompt

    if not keyword or not gpt_prompt:
        logger.warning("⚠️ Missing 'keyword' or 'prompt' in POST body")
        return respond(400, {"error": "Missing 'keyword' or 'prompt' in POST body"})

    logger.info(f"🔍 Body: {json.dumps(body)}")

    try:
        gpt_result = client.chat.completions.create(
            model="gpt-3.5-turbo",
            temperature=0.7,
            messages=[{"role": "user", "content": gpt_prompt}]  # 👈 Corrected
        )

        message = normalize_gpt_response(gpt_result.choices[0].message.content.strip())
        logger.info(f"🤖 OpenAI returned response: {message[:200]}...")

        record = {
            "GPT": keyword,
            "response": message,
            "promo": promo,
            "keyword": keyword,
            "prompt": gpt_prompt,  # Keep for traceability
            "createdAt": int(datetime.utcnow().timestamp())
        }

        table.put_item(Item=record)
        logger.info(f"💾 Stored GPT result under keyword: {keyword}")
        return respond(200, record)

    except Exception as e:
        logger.exception("🧠 OpenAI generation failed")
        return respond(502, {"error": f"OpenAI error: {str(e)}", "input": gpt_prompt})

def chat_direct(body):
    message = body.get("message", "").strip()
    model = body.get("model", "gpt-3.5-turbo").strip()

    if not message:
        return respond(400, {"error": "Missing 'message' in request body"})

    try:
        gpt_result = client.chat.completions.create(
            model=model,
            temperature=0.7,
            messages=[{"role": "user", "content": message}]
        )

        reply = gpt_result.choices[0].message.content.strip()
        logger.info(f"💬 Chat reply from {model}: {reply[:200]}...")

        return respond(200, {
            "model": model,
            "input": message,
            "response": reply
        })

    except Exception as e:
        logger.exception("🧠 Direct chat failed")
        return respond(502, {"error": f"Chat error: {str(e)}"})


# Custom encoder for Decimal
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps(body, cls=DecimalEncoder)
    }


### Helper functions ###
def purge_table():
    deleted = 0
    scan = table.scan(ProjectionExpression='GPT')
    with table.batch_writer() as batch:
        for item in scan['Items']:
            batch.delete_item(Key={'GPT': item['GPT']})
            deleted += 1
    logger.info(f"✅ Deleted {deleted} items from GPT_Transactions")
    return deleted

def list_gpt_entries():
    try:
        scan = table.scan()
        items = scan.get("Items", [])
        sorted_items = sorted(items, key=lambda x: x.get("createdAt", 0), reverse=True)

        return respond(200, {"gptEntries": sorted_items})
    except Exception as e:
        logger.exception("🛑 Failed to list GPT entries")
        return respond(500, {"error": str(e)})

def normalize_gpt_response(raw_response):
    raw = raw_response.strip()

    # Try to unwrap JSON-encoded strings repeatedly
    while True:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, str):
                raw = parsed.strip()
                continue
            return parsed  # Could be dict, list, number, etc.
        except json.JSONDecodeError:
            break

    # Try parsing as number
    try:
        if '.' in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        pass

    return raw  # Final fallback
