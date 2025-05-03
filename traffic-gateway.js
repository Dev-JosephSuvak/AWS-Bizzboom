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
  try {
    const body = JSON.parse(event.body || "{}");
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
      membership = {
        plan: null,
        tier: null,
        payment_freq: null,
        payment_amount: null,
        gptLimit: null,
        gptCount: null,
        sub_start: null,
        sub_end: null
      }
    } = body;

    const lowerEmail = email?.toLowerCase();
    const trimmedPrompt = (interest || gpt || "").trim().toLowerCase();

    if (!lowerEmail || !trimmedPrompt || !mode) {
      return respond(400, { error: "Missing required fields" });
    }

    switch (mode) {
      case "funnel":
        return await handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, destinationWebhook, method });
      case "search":
        return await handleSearchMode({ lowerEmail, membership, trimmedPrompt, destinationWebhook, method });
      case "user":
        return await handleUserMode({ lowerEmail, firstName, lastName, business, interest: trimmedPrompt, method });
      case "membership":
        return await handleMembershipMode({ lowerEmail, membership, method });
      default:
        return respond(400, { error: "Invalid mode" });
    }

  } catch (err) {
    console.error("❌ Error in handler:", err);
    return respond(500, { error: err.message || "Unhandled error" });
  }
};

async function handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, destinationWebhook, method }) {
  try {
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
  } catch (err) {
    if (err.response?.status === 404) {
      await axios({ method, url: USER_API, data: {
        email: lowerEmail,
        firstName,
        lastName,
        business,
        interest: trimmedPrompt
      }});
    } else throw err;
  }

  try {
    const res = await axios.get(`${GPT_API}?prompt=${encodeURIComponent(trimmedPrompt)}`);
    return respond(200, { output: res.data.response });
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  const funnelPrompt = `You are a digital product strategist. Given a hobby, interest, or passion, identify 10 profitable niche or sub-niche angles. For each, provide 10 beginner-friendly, high-demand digital product ideas (example (but don't limit responses to): ebooks, templates, courses, planners).

Use specific, modern titles that feel fresh and ready to sell. Avoid duplicates or vague categories.

Format your response as raw JSON like this: [{"${trimmedPrompt}": ["idea 1", "idea 2", "idea 3", ...]}]. Only return valid JSON. Do not include explanations, markdown, or code fences.

Interest: ${trimmedPrompt}`;

  const gptResponse = await generateViaOpenAI(funnelPrompt);

  await axios({ method, url: GPT_API, data: {
    prompt: funnelPrompt,
    response: gptResponse,
    promo: "Interest Funnel",
    keyword: trimmedPrompt
  }});

  if (destinationWebhook) {
    await postToWebhook(destinationWebhook, {
      email: lowerEmail,
      firstName,
      lastName,
      business,
      gpt: trimmedPrompt,
      output: gptResponse
    });
  }

  return respond(200, { output: gptResponse });
}

async function handleSearchMode({ lowerEmail, membership, trimmedPrompt, destinationWebhook, method }) {
  try {
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
  } catch (err) {
    if (err.response?.status === 404) {
      return respond(403, { error: "User not found. Search access restricted." });
    } else throw err;
  }

  const { data: remoteMembership } = await axios.get(`${MEMBERSHIP_API}?email=${encodeURIComponent(lowerEmail)}`);
  const now = Date.now();
  if (remoteMembership.gptCount >= remoteMembership.gptLimit || now > Number(remoteMembership.sub_end)) {
    return respond(403, { error: "Membership expired or GPT quota exceeded." });
  }

  const gptResponse = await generateViaOpenAI(trimmedPrompt);

  await axios({ method, url: GPT_API, data: {
    prompt: trimmedPrompt,
    response: gptResponse,
    promo: `${membership.tier} - ${membership.plan}`,
    keyword: trimmedPrompt
  }});

  if (destinationWebhook) {
    await postToWebhook(destinationWebhook, {
      email: lowerEmail,
      plan: membership.plan,
      tier: membership.tier,
      gpt: trimmedPrompt,
      output: gptResponse
    });
  }

  return respond(200, { output: gptResponse });
}

async function handleUserMode({ lowerEmail, firstName, lastName, business, interest, method }) {
  try {
    await axios.get(`${USER_API}?email=${encodeURIComponent(lowerEmail)}`);
  } catch (err) {
    if (err.response?.status === 404) {
      await axios({ method, url: USER_API, data: {
        email: lowerEmail,
        firstName,
        lastName,
        business,
        interest
      }});
    } else throw err;
  }

  return respond(200, { message: "User handled successfully" });
}

async function handleMembershipMode({ lowerEmail, membership, method }) {
  try {
    await axios.get(`${MEMBERSHIP_API}?email=${encodeURIComponent(lowerEmail)}`);
  } catch (err) {
    if (err.response?.status === 404) {
      await axios({ method, url: MEMBERSHIP_API, data: {
        email: lowerEmail,
        plan: membership.plan,
        tier: membership.tier,
        payment_freq: membership.payment_freq,
        payment_amount: membership.payment_amount,
        gptLimit: membership.gptLimit,
        gptCount: membership.gptCount,
        subscription_start: membership.sub_start,
        subscription_end: membership.sub_end
      }});
    } else throw err;
  }

  return respond(200, { message: "Membership handled successfully" });
}

async function generateViaOpenAI(prompt) {
  return [{ [prompt]: ["Idea 1", "Idea 2", "Idea 3"] }];
}

async function postToWebhook(url, payload) {
  try {
    await axios.post(url, payload);
  } catch (err) {
    console.warn("⚠️ Webhook failed:", err.message);
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body)
  };
}
