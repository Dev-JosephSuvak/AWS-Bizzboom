# BizzBoom AWS Documentation

This repository contains AWS Lambda functions designed to handle various aspects of a digital product platform. The architecture leverages Python for database manipulation endpoints to enable eventual aggregation advantages and JavaScript for the traffic gateway to simplify routing and integration.

## File Overview

### 1. `traffic-gateway.js`
**Purpose**: Acts as the central traffic interface for routing requests to the appropriate backend Lambda functions. Written in JavaScript for simplicity and modularity.

#### Key Modes:
- **`funnel`**: Handles user creation and GPT-based funnel generation.
- **`search`**: Validates user and membership, then generates GPT responses.
- **`user`**: Manages user data by interacting with the `user.py` Lambda.
- **`membership`**: Manages membership data by interacting with the `memberships.py` Lambda.

#### Example Usage:
- **Create a user**: Calls the `POST` method in `user.py` to create a new user.
- **Generate GPT funnel**: Calls the `GET` method in `gpt.py` to retrieve or generate GPT responses.

---
### User

#### CRUD Operations via `traffic-gateway.js`:

##### 1. **Create User**
**Request**:
```json
{
    "body": {
        "email": "example@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "business": "Tech Solutions",
        "interest": "AI Development",
        "mode": "user",
        "method": "post"
    }
}
```

**Translation in `user.py`**:
- **Mode**: `user`
- **HTTP Method**: `POST`
- **Action**: Calls the `create_user` method in `user.py` to add a new user to the DynamoDB table.

**Result**:
The `create_user` function processes the request, validates the input, and stores the user data in the DynamoDB table. If successful, it returns:
```json
{
    "statusCode": 201,
    "body": {
        "message": "User created",
        "data": {
            "email": "example@example.com",
            "firstName": "John",
            "lastName": "Doe",
            "business": "Tech Solutions",
            "interest": "AI Development",
            "createdAt": "2023-10-01T12:00:00Z"
        }
    }
}
```

---

##### 2. **Retrieve User**
**Request**:
```json
{
    "queryStringParameters": {
        "email": "example@example.com"
    },
    "mode": "user",
    "method": "get"
}
```

**Translation in `user.py`**:
- **Mode**: `user`
- **HTTP Method**: `GET`
- **Action**: Calls the `get_user` method in `user.py` to retrieve user details from the DynamoDB table.

**Result**:
The `get_user` function fetches the user data by email. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "email": "example@example.com",
        "firstName": "John",
        "lastName": "Doe",
        "business": "Tech Solutions",
        "interest": "AI Development",
        "createdAt": "2023-10-01T12:00:00Z"
    }
}
```

---

##### 3. **Update User**
**Request**:
```json
{
    "body": {
        "email": "example@example.com",
        "firstName": "Jonathan",
        "business": "Tech Innovations",
        "mode": "user",
        "method": "put"
    }
}
```

**Translation in `user.py`**:
- **Mode**: `user`
- **HTTP Method**: `PUT`
- **Action**: Calls the `update_user` method in `user.py` to update user details in the DynamoDB table.

**Result**:
The `update_user` function updates the specified fields for the user. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "message": "User updated",
        "fields": ["firstName", "business"]
    }
}
```

---

##### 4. **Delete User**
**Request**:
```json
{
    "queryStringParameters": {
        "email": "example@example.com"
    },
    "mode": "user",
    "method": "delete"
}
```

**Translation in `user.py`**:
- **Mode**: `user`
- **HTTP Method**: `DELETE`
- **Action**: Calls the `delete_user` method in `user.py` to remove the user from the DynamoDB table.

**Result**:
The `delete_user` function deletes the user by email. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "message": "User deleted",
        "email": "example@example.com"
    }
}
```

---

##### 5. **To Be Implemented: Bulk User Operations**
**Planned Features**:
- **Bulk Create**: Accepts a list of users and adds them to the DynamoDB table.
- **Bulk Update**: Updates multiple users based on a list of email addresses and fields.
- **Bulk Delete**: Deletes multiple users by their email addresses.

These features will enhance scalability and streamline operations for large datasets.
```

---
### 3. `memberships.py`
**Purpose**: Manages membership data for reporting and permission validation. Data is stored in a DynamoDB table.

#### CRUD Operations via `traffic-gateway.js`:

##### 1. **Create Membership**
**Request**:
```json
{
    "membership": {
        "email": "example@example.com",
        "gptLimit": 100,
        "gptCount": 0,
        "subscription_start": 1696156800,
        "subscription_end": 1703980800,
        "tier": "Gold",
        "payment_freq": "monthly",
        "mode": "membership",
        "method": "post"
    }
}
```

**Translation in `memberships.py`**:
- **Mode**: `membership`
- **HTTP Method**: `POST`
- **Action**: Calls the `create_membership` method in `memberships.py` to add a new membership record to the DynamoDB table.

**Result**:
The `create_membership` function processes the request, validates the input, and stores the membership data in the DynamoDB table. If successful, it returns:
```json
{
    "statusCode": 201,
    "body": {
        "message": "Membership created",
        "membership": {
            "email": "example@example.com",
            "gptLimit": 100,
            "gptCount": 0,
            "subscription_start": 1696156800,
            "subscription_end": 1703980800,
            "tier": "Gold",
            "payment_freq": "monthly",
            "lastUpdated": 1696156800
        }
    }
}
```

---

##### 2. **Retrieve Membership**
**Request**:
```json
{
    "queryStringParameters": {
        "email": "example@example.com"
    },
    "mode": "membership",
    "method": "get"
}
```

**Translation in `memberships.py`**:
- **Mode**: `membership`
- **HTTP Method**: `GET`
- **Action**: Calls the `get_membership` method in `memberships.py` to retrieve membership details from the DynamoDB table.

**Result**:
The `get_membership` function fetches the membership data by email. If successful, it returns:
```json
{
    "statusCode": 200,
    "membership": {
        "email": "example@example.com",
        "gptLimit": 100,
        "gptCount": 0,
        "subscription_start": 1696156800,
        "subscription_end": 1703980800,
        "tier": "Gold",
        "payment_freq": "monthly",
        "lastUpdated": 1696156800
    }
}
```

---

##### 3. **Update Membership**
**Request**:
```json
{
    "body": {
        "email": "example@example.com",
        "gptLimit": 200,
        "tier": "Platinum",
        "mode": "membership",
        "method": "put"
    }
}
```

**Translation in `memberships.py`**:
- **Mode**: `membership`
- **HTTP Method**: `PUT`
- **Action**: Calls the `update_membership` method in `memberships.py` to update membership details in the DynamoDB table.

**Result**:
The `update_membership` function updates the specified fields for the membership. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "message": "Membership updated",
        "fields": ["gptLimit", "tier"]
    }
}
```

---

##### 4. **Delete Membership**
**Request**:
```json
{
    "queryStringParameters": {
        "email": "example@example.com"
    },
    "mode": "membership",
    "method": "delete"
}
```

**Translation in `memberships.py`**:
- **Mode**: `membership`
- **HTTP Method**: `DELETE`
- **Action**: Calls the `delete_membership` method in `memberships.py` to remove the membership from the DynamoDB table.

**Result**:
The `delete_membership` function deletes the membership by email. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "message": "Membership deleted",
        "email": "example@example.com"
    }
}
```

---

##### 5. **To Be Implemented: Bulk Membership Operations**
**Planned Features**:
- **Bulk Create**: Accepts a list of memberships and adds them to the DynamoDB table.
- **Bulk Update**: Updates multiple memberships based on a list of email addresses and fields.
- **Bulk Delete**: Deletes multiple memberships by their email addresses.

These features will enhance scalability and streamline operations for large datasets.

### 4. `gpt.py`
**Purpose**: Interacts with OpenAI's GPT-3.5-turbo model to generate or retrieve GPT responses. Results are stored in a DynamoDB table.

#### CRUD Operations via `traffic-gateway.js`:

##### 1. **Retrieve GPT Response**
**Request**:
```json
{
    "queryStringParameters": {
        "keyword": "example-keyword",
        "gptInput": "Provide 10 ideas for digital products in the AI niche."
    },
    "mode": "search",
    "method": "get"
}
```

**Translation in `gpt.py`**:
- **Mode**: `search`
- **HTTP Method**: `GET`
- **Action**: Calls the `get_or_generate` method in `gpt.py` to retrieve a GPT response by keyword or generate a new one using OpenAI's API.

**Result**:
The `get_or_generate` function checks if a response exists for the given keyword in the DynamoDB table. If not, it generates a new response using OpenAI's GPT-3.5-turbo model and stores it in the table. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "prompt": "example-keyword",
        "response": {
            "example-keyword": ["Idea 1", "Idea 2", "Idea 3"]
        },
        "promo": "",
        "gptInput": "Provide 10 ideas for digital products in the AI niche.",
        "createdAt": 1696156800
    }
}
```

---

##### 2. **Generate GPT Funnel**
**Request**:
```json
{
    "body": {
        "email": "example@example.com",
        "gpt": "AI Development",
        "mode": "funnel",
        "method": "post"
    }
}
```

**Translation in `gpt.py`**:
- **Mode**: `funnel`
- **HTTP Method**: `POST`
- **Action**: Calls the `get_or_generate` method in `gpt.py` to generate a GPT response for a funnel prompt.

**Result**:
The `get_or_generate` function generates a GPT response based on the funnel prompt and stores it in the DynamoDB table. If successful, it returns:
```json
{
    "statusCode": 200,
    "body": {
        "prompt": "ai-development",
        "response": {
            "ai-development": ["Idea 1", "Idea 2", "Idea 3"]
        },
        "promo": "Interest Funnel",
        "gptInput": "You are a digital product strategist. Given a hobby, interest, or passion, identify 10 profitable niche or sub-niche angles...",
        "createdAt": 1696156800
    }
}
```

---

##### 3. **To Be Implemented: Bulk GPT Operations**
**Planned Features**:
- **Bulk Retrieve**: Accepts a list of keywords and retrieves GPT responses for all of them.
- **Bulk Generate**: Generates GPT responses for multiple prompts and stores them in the DynamoDB table.

These features will enhance scalability and streamline operations for handling large datasets.


---

## Architecture Summary
- **Traffic Gateway**: Written in JavaScript for ease of integration and routing.
- **Database Endpoints**: Written in Python to leverage its strengths in data manipulation and aggregation.
- **DynamoDB**: Used as the primary database for all user, membership, and GPT-related data.

This modular design ensures scalability, maintainability, and efficient data handling across the platform.