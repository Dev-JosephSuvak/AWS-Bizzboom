/* This is for an AWS Lambda function that acts as a traffic interface for a lambda function. 
* It intakes the mode of operation and the body. 
* It then routes the request to the appropriate function based on the mode. 
* Each mode has its own logic and handles the request accordingly including error handling.
* The function also handles the response and returns it in a standard format.
* The function is designed to be used with AWS Lambda and API Gateway.
* It uses axios for making HTTP requests to other AWS private REST APIs.
* The function is designed to be modular and incrementable (by product keyword aka. "mode").
* The function uses environment variables to get the API endpoints from AWS under Configuration > Env. Variables.
*/
import axios from "axios";

const USER_API = process.env.USER_API;
const MEMBERSHIP_API = process.env.MEMBERSHIP_API;
const GPT_API = process.env.GPT_API;

export const handler = async (event) => {
  console.log("📥 [handler] Event received:", JSON.stringify(event));

  try {
    if (!event.body) {
      console.log("❌ [handler] Missing body");
      return respond(400, { error: "Missing body", event });
    }

    const body = JSON.parse(event.body || "{}");
    console.log("📦 [handler] Parsed body:", body);

    const {
      email,
      firstName,
      lastName,
      business,
      gpt,
      interest,
      destinationWebhook = null,
      mode = "funnel",
      method = "post",
      membership = {}
    } = body;

    const lowerEmail = email?.toLowerCase();
    const trimmedPrompt = (interest || gpt || "").trim().toLowerCase();

    console.log("🧪 [handler] Inputs: email =", lowerEmail, "prompt =", trimmedPrompt, "mode =", mode);

    if (!lowerEmail || !trimmedPrompt || !mode) {
      console.log("❌ [handler] Missing required fields");
      return respond(400, {
        error: "Missing required fields",
        fields: { email: lowerEmail, interest_or_gpt: interest || gpt, mode }
      });
    }

    switch (mode) {
      case "funnel":
        console.log("🔁 [handler] Routing to handleFunnelMode");
        return await handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, destinationWebhook, method });

      case "search":
        console.log("🔁 [handler] Routing to handleSearchMode");
        return await handleSearchMode({ lowerEmail, membership, trimmedPrompt, destinationWebhook, method });

      case "user":
        console.log("🔁 [handler] Routing to handleUserMode");
        return await handleUserMode({ lowerEmail, firstName, lastName, business, interest: trimmedPrompt, method });

      case "membership":
        console.log("🔁 [handler] Routing to handleMembershipMode");
        return await handleMembershipMode({ lowerEmail, membership, method });

      default:
        console.log("❌ [handler] Invalid mode");
        return respond(400, { error: "Invalid mode" });
    }
  } catch (err) {
    console.error("🔥 [handler] Error:", err);
    return respond(500, { error: err.message || "Unhandled error" });
  }
};

async function handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, destinationWebhook, method }) {
  console.log("▶️ [funnel] Start", { lowerEmail, trimmedPrompt });

  try {
    console.log("🔍 [funnel] Checking user existence...");
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
    console.log("✅ [funnel] User exists");
  } catch (err) {
    if (err.response?.status === 404) {
      console.log("🆕 [funnel] Creating user...");
      await axios({
        method,
        url: USER_API,
        data: { email: lowerEmail, firstName, lastName, business, interest: trimmedPrompt }
      });
      console.log("✅ [funnel] User created");
    } else {
      console.error("❌ [funnel] User check failed:", err.message);
      throw err;
    }
  }

  try {
    console.log("📦 [funnel] Checking GPT cache...");
    const res = await axios.get(`${GPT_API}?keyword=${encodeURIComponent(trimmedPrompt)}&cacheOnly=true`);
    console.log("✅ [funnel] Cache hit");
  
    let cachedOutput;
    try {
      cachedOutput = JSON.parse(res.data.response);
      console.log("✅ [funnel] Parsed cached GPT response");
    } catch (parseErr) {
      console.warn("⚠️ [funnel] Failed to parse cached GPT response. Returning raw string.");
      cachedOutput = res.data.response;
    }
  
    return respond(202, { output: cachedOutput });
  
  } catch (err) {
    if (err.response?.status !== 404) {
      console.error("❌ [funnel] GPT GET failed:", err.message);
      throw err;
    }
    console.log("📭 [funnel] Cache miss");
  }
  

  const funnelPrompt = `You are a digital product strategist. Given a hobby, interest, or passion, identify 10 profitable niche or sub-niche angles. For each, provide 10 beginner-friendly, high-demand digital product ideas (example (but don't limit responses to): ebooks, templates, courses, planners).
    Use specific, modern titles that feel fresh and ready to sell. Avoid duplicates or vague categories.
    Format your response as raw JSON like this: [{"surfing": ["idea 1", "idea 2", "idea 3", ...]}]. Only return valid JSON. Do not include explanations, markdown, or code fences.
    Interest: ${trimmedPrompt}`;

  console.log("🧠 [funnel] Sending to GPT with prompt:", funnelPrompt);

  const postRes = await axios({
    method: "POST",
    url: GPT_API,
    data: {
      prompt: funnelPrompt,
      keyword: trimmedPrompt,
      promo: "Interest Funnel",
      gptInput: trimmedPrompt
    }
  });

  const gptResponse = postRes.data.response;
  console.log("🤖 [funnel] GPT Response:", gptResponse);

  if (destinationWebhook) {
    console.log("📤 [funnel] Sending to webhook...");
    await postToWebhook(destinationWebhook, {
      email: lowerEmail,
      firstName,
      lastName,
      business,
      gpt: trimmedPrompt,
      output: gptResponse
    });
    console.log("✅ [funnel] Webhook sent");
  }

  console.log("🏁 [funnel] Returning final response");
  return respond(200, {
    input: {
      prompt: funnelPrompt,
      keyword: trimmedPrompt,
      promo: "Interest Funnel",
      gptInput: trimmedPrompt
    },
    output: gptResponse
  });
}

async function handleSearchMode({ lowerEmail, membership, trimmedPrompt, destinationWebhook, method }) {
  console.log("▶️ [search] Start", { lowerEmail, trimmedPrompt });

  try {
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
    console.log("✅ [search] User verified");
  } catch (err) {
    if (err.response?.status === 404) {
      console.log("❌ [search] User not found");
      return respond(403, { error: "User not found. Search access restricted." });
    } else throw err;
  }

  const { data: remoteMembership } = await axios.get(`${MEMBERSHIP_API}?email=${encodeURIComponent(lowerEmail)}`);
  const now = Date.now();

  console.log("📊 [search] Membership check", remoteMembership);

  if (remoteMembership.gptCount >= remoteMembership.gptLimit || now > Number(remoteMembership.sub_end)) {
    return respond(403, { error: "Membership expired or GPT quota exceeded." });
  }

  const gptResponse = await generateViaOpenAI(trimmedPrompt);
  console.log("🤖 [search] GPT Response:", gptResponse);

  await axios({
    method,
    url: GPT_API,
    data: {
      prompt: trimmedPrompt,
      response: gptResponse,
      promo: `${membership.tier} - ${membership.plan}`,
      keyword: trimmedPrompt
    }
  });

  if (destinationWebhook) {
    await postToWebhook(destinationWebhook, {
      email: lowerEmail,
      plan: membership.plan,
      tier: membership.tier,
      gpt: trimmedPrompt,
      output: gptResponse
    });
  }

  console.log("🏁 [search] Done");
  return respond(200, { output: gptResponse });
}

async function handleUserMode({ lowerEmail, firstName, lastName, business, interest, method }) {
  console.log("▶️ [user] Start", { lowerEmail, interest });

  try {
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
    console.log("✅ [user] User exists");
  } catch (err) {
    if (err.response?.status === 404) {
      await axios({
        method,
        url: USER_API,
        data: { email: lowerEmail, firstName, lastName, business, interest }
      });
      console.log("✅ [user] Created new user");
    } else throw err;
  }

  console.log("🏁 [user] Done");
  return respond(200, { message: "User handled successfully" });
}

async function handleMembershipMode({ lowerEmail, membership, method }) {
  console.log("▶️ [membership] Start", { lowerEmail });

  try {
    await axios.get(`${MEMBERSHIP_API}?email=${encodeURIComponent(lowerEmail)}`);
    console.log("✅ [membership] Exists");
  } catch (err) {
    if (err.response?.status === 404) {
      await axios({
        method,
        url: MEMBERSHIP_API,
        data: {
          email: lowerEmail,
          plan: membership.plan,
          tier: membership.tier,
          payment_freq: membership.payment_freq,
          payment_amount: membership.payment_amount,
          gptLimit: membership.gptLimit,
          gptCount: membership.gptCount,
          subscription_start: membership.sub_start,
          subscription_end: membership.sub_end
        }
      });
      console.log("✅ [membership] Created new");
    } else throw err;
  }

  console.log("🏁 [membership] Done");
  return respond(200, { message: "Membership handled successfully" });
}

async function postToWebhook(url, payload) {
  console.log("🚀 [webhook] Posting to:", url);
  try {
    await axios.post(url, payload);
    console.log("✅ [webhook] Sent");
  } catch (err) {
    console.warn("⚠️ [webhook] Failed:", err.message);
  }
}

function respond(statusCode, body) {
  console.log("📝 [respond]", { statusCode, body });
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body)
  };
}

async function generateViaOpenAI(prompt) {
  console.log("🧠 [generateViaOpenAI] Called with prompt:", prompt);
  return [{ [prompt]: ["Idea 1", "Idea 2", "Idea 3"] }];
}
