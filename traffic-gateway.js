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
const POWERPLAYS_API = process.env.POWERPLAYS_API;


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
      destinationWebhook,
      mode = "funnel",
      method = "post",
      membership = {},
      step,
      user = {
      }
    } = body;

    const lowerEmail = email?.toLowerCase();
    const trimmedPrompt = (interest || gpt || "").trim().toLowerCase();
    const webhook = destinationWebhook?.trim();

    console.log("🧪 [handler] Inputs: user =", body.user, "; Step =", step);

    const skipValidationModes = [
      "passion-product",
      "powerplay",
      "powerplay-create",
    ];

    if (!skipValidationModes.includes(mode) && (!lowerEmail || !trimmedPrompt || !mode)) {
      console.log("❌ [handler] Missing required fields");
      return respond(400, {
        error: "Missing required fields",
        fields: {
          email: lowerEmail,
          interest_or_gpt: interest || gpt,
          mode
        }
      });
    }


    switch (mode) {
      case "funnel":
        console.log("🔁 [handler] Routing to handleFunnelMode");
        console.log("🔁 [handler] Destination Webook", webhook);
        return await handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, webhook, method });

      case "passion-product":
        return await handlePassionProductMode({ trimmedPrompt });

      case "search":
        console.log("🔁 [handler] Routing to handleSearchMode");
        return await handleSearchMode({ lowerEmail, membership, trimmedPrompt, webhook, method });

      case "user":
        console.log("🔁 [handler] Routing to handleUserMode");
        return await handleUserMode({ lowerEmail, firstName, lastName, business, interest: trimmedPrompt, method });

      case "membership":
        console.log("🔁 [handler] Routing to handleMembershipMode");
        return await handleMembershipMode({ lowerEmail, membership, method });

      case "powerplay":
        console.log("🔁 [handler] Routing to handlePowerplayMode");
        return await handlePowerplayMode({ step, user });

      case "powerplay-create":
        console.log("🛠 Routing: step 1 abstract Powerplay creation");
        return await createInitialPowerplay({ user });

      default:
        console.log("❌ [handler] Invalid mode");
        return respond(400, { error: "Invalid mode" });
    }
  } catch (err) {
    console.error("🔥 [handler] Error:", err);
    return respond(500, { error: err.message || "Unhandled error" });
  }
};
async function handleFunnelMode({ lowerEmail, firstName, lastName, business, trimmedPrompt, webhook, method }) {
  console.log("▶️ [funnel] Start", { lowerEmail, trimmedPrompt });

  // 🔍 Step 1: Ensure User Exists or Create
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

  // 📦 Step 2: Try GPT Cache First
  try {
    console.log("📦 [funnel] Checking GPT cache...");
    const res = await axios.get(`${GPT_API}?keyword=${encodeURIComponent(trimmedPrompt)}&cacheOnly=true`);
    console.log("✅ [funnel] Cache hit");

    let cachedOutput;
    try {
      cachedOutput = typeof res.data.response === "string"
        ? JSON.parse(res.data.response)
        : res.data.response;

      if (!Array.isArray(cachedOutput)) {
        cachedOutput = [cachedOutput];
      }

      console.log("✅ [funnel] Parsed and normalized cached GPT response");
    } catch (parseErr) {
      console.warn("⚠️ [funnel] Failed to parse cached GPT response. Returning as-is:", parseErr.message);
      cachedOutput = [res.data.response || res.data];
    }

    const wrappedCachedOutput = { response: cachedOutput };
    console.log("🤖 [funnel] Cached GPT Response:", wrappedCachedOutput);

    if (typeof webhook === "string" && webhook.trim() && webhook !== "null") {
      console.log("📤 [funnel] Sending to webhook...");
      await postToWebhook(webhook, {
        email: lowerEmail,
        firstName,
        lastName,
        business,
        input: {
          keyword: res.data.keyword,
          promo: "Interest Funnel"
        },
        output: {
          gptResponse: cachedOutput,
          formattedText: extractAndFormatIdeas(wrappedCachedOutput),
        }
      });
      console.log("✅ [funnel] Webhook sent");
    }

    return respond(202, {
      output: {
        gptResponse: cachedOutput,
        formattedText: extractAndFormatIdeas(wrappedCachedOutput)
      }
    });

  } catch (err) {
    if (err.response?.status !== 404) {
      console.error("❌ [funnel] GPT GET failed:", err.message);
      throw err;
    }
    console.log("📭 [funnel] Cache miss");
  }

  // 🤖 Step 3: Prompt GPT Directly
  const funnelPrompt = `You are a digital product strategist.
  Given a hobby, interest, or passion, identify profitable niches or sub-niche angles. For each niche, provide 50 beginner-friendly, high-demand digital product ideas (example (but don't limit responses to): ebooks, templates, courses, planners).
  Use specific, modern titles that feel fresh and ready to sell. You should have a total of 50 ideas. Avoid duplicates or vague categories.
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

  let gptResponse = postRes.data.response;
  try {
    gptResponse = typeof gptResponse === "string"
      ? JSON.parse(gptResponse)
      : gptResponse;

    if (!Array.isArray(gptResponse)) {
      gptResponse = [gptResponse];
    }

    console.log("✅ [funnel] GPT response parsed and normalized");
  } catch (err) {
    console.warn("⚠️ [funnel] GPT response not JSON parsable, wrapping raw:", err.message);
    gptResponse = [gptResponse];
  }

  const wrappedOutput = { response: gptResponse };
  console.log("🤖 [funnel] GPT Response:", wrappedOutput);

  if (typeof webhook === "string" && webhook.trim() && webhook !== "null") {
    console.log("📤 [funnel] Sending to webhook...");
    await postToWebhook(webhook, {
      email: lowerEmail,
      firstName,
      lastName,
      business,
      input: {
        prompt: funnelPrompt,
        keyword: trimmedPrompt,
        promo: "Interest Funnel",
        gptInput: trimmedPrompt
      },
      output: {
        gptResponse,
        formattedText: extractAndFormatIdeas(wrappedOutput),
      }
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
    output: {
      gptResponse,
      formattedText: extractAndFormatIdeas(wrappedOutput),
    }
  });
}


async function handlePowerplayMode({ step, user, platform = "pinterest" }) {
  if (!user?.email) return respond(400, { error: "Missing user email" });

  if (step === 1) {
    try {
      const res = await axios.post(POWERPLAYS_API, user);
      return respond(201, { message: "✅ Step 1 Powerplay created", data: res.data });
    } catch (err) {
      return respond(500, { error: "❌ Step 1 creation failed: " + err.message });
    }
  }

  const config = PLATFORM_STEPS[platform]?.[step];
  if (!config) return respond(400, { error: `❌ Unsupported step ${step} for platform ${platform}` });

  try {
    const { data } = await axios.get(`${POWERPLAYS_API}?email=${encodeURIComponent(user.email)}`);
    const powerplay = data?.powerplays?.[0];

    if (!powerplay || !powerplay.topic) {
      return respond(400, { error: "Missing topic or invalid powerplay object" });
    }

    const prompt = config.promptBuilder(powerplay);
    const gptRes = await axios.post(GPT_API, {
      prompt,
      keyword: powerplay.topic.toLowerCase(),
      promo: config.promo,
      gptInput: prompt
    });

    let result = gptRes.data?.response || {};
    if (typeof result === "string") {
      try {
        result = JSON.parse(result.replace(/\/\/.*$/gm, "").trim());
      } catch (e) {
        return respond(500, { error: "GPT response was not valid JSON", raw: result });
      }
    }

    const patchBody = {
      email: user.email,
      step,
      ...config.patchKeys(result)
    };

    const updateRes = await axios.patch(POWERPLAYS_API, patchBody);
    return respond(200, {
      message: `✅ Step ${step} Powerplay updated`,
      data: updateRes.data
    });
  } catch (err) {
    return respond(500, { error: `❌ Step ${step} failed: ` + err.message });
  }
}


async function handlePassionProductMode({ trimmedPrompt }) {
  console.log("▶️ [passion-product] Start with keyword:", trimmedPrompt);

  const funnelPrompt = `You are a digital product strategist.
Given a single hobby, interest, or passion, identify 3–5 highly profitable niche or sub-niche categories related to it.
For each niche or sub-niche, generate approximately 20 unique, beginner-friendly digital product ideas. Examples include: ebooks, templates, printables, mini-courses, planners, or toolkits.
All ideas should use fresh, modern, and specific titles that feel ready to sell — avoid vague phrasing or duplicates.
Return your answer as raw JSON, in the following format: [{"<niche name>": ["idea 1", "idea 2", ..., "idea 20"]}, ...].
Only return valid JSON. Do not include markdown, explanations, or code fences.
Interest: ${trimmedPrompt}`;


  const postRes = await axios({
    method: "POST",
    url: GPT_API,
    data: {
      prompt: funnelPrompt,
      keyword: trimmedPrompt,
      promo: "Passion Product",
      gptInput: trimmedPrompt
    }
  });

  let gptResponse = postRes.data.response;

  try {
    gptResponse = typeof gptResponse === "string"
      ? JSON.parse(gptResponse)
      : gptResponse;

    if (!Array.isArray(gptResponse)) {
      gptResponse = [gptResponse];
    }

    console.log("✅ [passion-product] Parsed GPT response");
  } catch (err) {
    console.warn("⚠️ [passion-product] GPT response not JSON parsable:", err.message);
    gptResponse = [gptResponse];
  }

  const formattedText = extractAndFormatIdeas({ response: gptResponse });

  return respond(200, {
    input: {
      prompt: funnelPrompt,
      keyword: trimmedPrompt,
      promo: "Passion Product"
    },
    output: {
      gptResponse,
      formattedText
    }
  });
}

async function handleSearchMode({ lowerEmail, membership, trimmedPrompt, webhook, method }) {
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

  if (typeof webhook === "string" && webhook.trim() !== "" && webhook !== "null") {
    await postToWebhook(webhook, {
      email: lowerEmail,
      plan: membership.plan,
      tier: membership.tier,
      gpt: trimmedPrompt,
      output: {
        gptResponse,
        formattedText: extractAndFormatIdeas(gptResponse),
      }
    });
  }

  console.log("🏁 [search] Done");
  return respond(200, {
    output: {
      gptResponse,
      formattedText: extractAndFormatIdeas(gptResponse),
    }
  });
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

function extractAndFormatIdeas(output) {
  try {
    const responseArray = output?.response;
    if (!Array.isArray(responseArray) || responseArray.length === 0) return "";

    let html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; text-align: center;">
        <h2 style="font-size: 24px; color: #04075b; margin-bottom: 20px;">📘 Your Personalized Idea List</h2>
    `;

    responseArray.forEach(group => {
      const [niche, ideas] = Object.entries(group)[0];

      html += `<h3 style="margin-top: 20px; color: #333;">${niche}</h3>`;

      ideas.forEach((idea, i) => {
        const clean = idea.replace(/^\d+\.\s*/, "").trim();
        html += `<p style="margin: 4px 0;">${i + 1}. ${clean}</p>`;
      });
    });

    html += `</div>`;
    return html.trim();

  } catch (err) {
    console.warn("⚠️ Failed to format HTML ideas:", err.message);
    return "";
  }
}

function buildPinterestNichePrompt(user) {
  return `You are a Pinterest marketing strategist.\n\nUsing the following business info, generate a JSON response with 5 Pinterest-friendly niche options I could explore for content and monetization. Each niche should follow the provided structure exactly.\n\nBusiness Info:\n- Topic: ${user.topic}\n- Business Name: ${user.businessName}\n- Style: ${user.style}\n- Brand Colors: ${user.colors}\n- Fonts: ${user.fonts}\n- Website URL: ${user.websiteUrl}\n- I ${user.hasBrand ? "do" : "don’t"} have a brand established yet.\n\nFor each of the 5 niches, include the following fields:\n- title\n- audience\n- problem\n- contentIdeas (array of 3)\n- commonMistakes (array of 5 with mistake, solution, tip)\n- searchBehaviors\n- keywords (array of 5)\n\nReturn valid JSON in this format:\n{\n  \"niche1\": { ... },\n  \"niche2\": { ... },\n  \"niche3\": { ... },\n  \"niche4\": { ... },\n  \"niche5\": { ... }\n}`;
}

function buildPinterestStep3Prompt(powerplay) {
  const niches = powerplay?.pinterest?.niche || {};
  const nicheLines = Object.values(niches)
    .filter(n => typeof n === "object")
    .map(n => `- ${n.title} (Audience: ${n.audience})`)
    .join("\n");

  return `
      You are a Pinterest marketing strategist.

      Using the following business info and niche breakdowns, generate a clean, valid JSON object with affiliate products, board structures, and a keyword map.

      Business Info:
      - Business Name: ${powerplay.businessName}
      - Topic: ${powerplay.topic}
      - Style: ${powerplay.style}
      - Website: ${powerplay.websiteUrl}

      Niches:
      ${nicheLines}

      PART 1: Affiliate Products
      Return an array of 5 affiliate product objects (1 per niche) with:
      - productName
      - reasonFit (why it's a great fit for that niche's audience)
      - contentIdea (Pinterest pin idea for that product)
      - disclosureTip (best practice for affiliate disclosure)

      PART 2: Pinterest Boards
      Return an array of 10 board objects (2 per niche). Each should have:
      - title
      - description
      - pins: an array of 10 pins, each with:
        - title (under 100 characters, include a keyword)
        - description (100–200 characters with long-tail keywords and a call-to-action)
        - altText
        - suggestion (format or CTA guidance)

      PART 3: Keyword Map
      Return an array of 5 content category objects with:
      - category
      - keywords (10 keyword strings)
      - boardSuggestion (recommended board title)
      - pinIdeas (2 example pin titles or topics)

      Return ONLY a valid JSON object in the format:
      {
        "affiliateProducts": [...],
        "boards": [...],
        "keywordMap": [...]
      }
      Do NOT include markdown, bullet characters, headings, or comments.
`.trim();
}

function buildPinterestStep4Prompt(powerplay) {
  const boards = powerplay?.pinterest?.boards || [];
  const niches = powerplay?.pinterest?.niche || {};

  return `You are a Pinterest strategist helping a business create SEO-optimized, persuasive Pinterest pins for maximum engagement and discoverability.

  Business Info:
  - Name: ${powerplay.businessName}
  - Website: ${powerplay.websiteUrl}
  - Style: ${powerplay.style}
  - Topic: ${powerplay.topic}

  Audience Niches:
  ${Object.values(niches).filter(n => typeof n === 'object').map(n => `• ${n.title}: ${n.audience}`).join("\n")}

  Task:
  For each board below, generate 10 Pinterest pins. Each pin should be **highly relevant to the board’s niche and audience**.

  For **each pin**, provide:
  - **title**: Under 100 characters, use bolded keywords, power words, and formats like “How to”, “Top 5”, “Quick Tips” (from Prompt 2)
  - **description**: 100–200 characters, include natural long-tail keywords, appeal to audience goals or struggles, and end with a CTA like “Click to learn more” or "Save for Later" (from Prompt 1)
  - **altText**: Accessibility-friendly description of the visual and topic
  - **suggestion**: Brief style or CTA tip (e.g., “Use bold typography and a red callout banner”)

  Boards:
  ${boards.map((b, i) => `• board${i + 1}: ${b.title} — ${b.description}`).join("\n")}

  Output JSON format:
  {
    "pins": {
      "board1": [ { "title": "...", "description": "...", "altText": "...", "suggestion": "..." }, ... ],
      "board2": [...],
      ...
    }
  }
  Return only valid JSON. No commentary, no markdown.`;
}

function buildPinterestStep5Prompt(powerplay) {
  const niches = powerplay?.pinterest?.niche || {};
  const nicheTitles = Object.values(niches)
    .filter(n => typeof n === "object" && n.title)
    .map(n => n.title)
    .join(", ") || "multiple Pinterest niches I'm exploring";

  return `You are a Pinterest SEO expert.

My niche areas include: ${nicheTitles}

I want to find high-performing Pinterest keywords tailored to these topics.

Suggest 5 keyword research tools I can use. Return:
- 2 free tools
- 3 paid tools

For each tool, include:
- name
- url
- features (e.g., keyword suggestions, search volume, Pinterest trend data)
- bestFor (beginner or advanced users)

Format as raw JSON like this:
[
  {
    "name": "Tool Name",
    "url": "https://example.com",
    "features": "Keyword suggestions, Pinterest trends, SEO insights",
    "bestFor": "Beginner"
  }
]

Only return valid JSON. Do not include extra formatting, markdown, or comments.`;
}

const PLATFORM_STEPS = {
  pinterest: {
    2: {
      promptBuilder: buildPinterestNichePrompt,
      patchKeys: (res) => {
        const patch = {};
        Object.entries(res).forEach(([key, val]) => {
          patch[`pinterest.niche.${key}`] = val;
        });
        return patch;
      },
      promo: "Pinterest Powerplay Step 2"
    },
    3: {
      promptBuilder: buildPinterestStep3Prompt,
      patchKeys: (res) => ({
        "pinterest.affiliate": res.affiliateProducts,
        "pinterest.boards": res.boards,
        "pinterest.keywordMap": res.keywordMap
      }),
      promo: "Pinterest Powerplay Step 3"
    },
    4: {
      promptBuilder: buildPinterestStep4Prompt,
      patchKeys: (res) => ({ "pinterest.pins": res.pins }),
      promo: "Pinterest Powerplay Step 4"
    },
    5: {
      promptBuilder: buildPinterestStep5Prompt,
      patchKeys: (res) => ({ "pinterest.resources": res }),
      promo: "Pinterest Powerplay Step 5"
    }
  }
  // Extend for facebook, x, etc. later
};
