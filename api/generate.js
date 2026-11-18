"use strict";

var hits = new Map();

var MAPS = ["Farm", "Valley", "Northridge", "Armory", "TV Station", "Port"];
var MODES = ["Normal", "Lockdown", "Forbidden"];
var TONES = ["tactical", "funny", "savage"];

function integerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function finiteInRange(value, min, max) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max;
}

function validBody(body) {
  return body &&
    MAPS.indexOf(body.map) !== -1 &&
    MODES.indexOf(body.mode) !== -1 &&
    TONES.indexOf(body.tone) !== -1 &&
    typeof body.survived === "boolean" &&
    integerInRange(body.loadoutCost, 0, 999999999) &&
    integerInRange(body.ammoCost, 0, 999999999) &&
    integerInRange(body.consumableCost, 0, 999999999) &&
    integerInRange(body.entryCost, 0, 999999999) &&
    integerInRange(body.lootValue, 0, 999999999) &&
    integerInRange(body.kills, 0, 99) &&
    integerInRange(body.assists, 0, 99) &&
    integerInRange(body.revives, 0, 99) &&
    typeof body.tone === "string" &&
    typeof body.map === "string" &&
    typeof body.mode === "string";
}

function calculate(body) {
  var totalCost =
    body.loadoutCost +
    body.ammoCost +
    body.consumableCost +
    body.entryCost;

  var netResult = body.lootValue - totalCost;
  var multiplier = totalCost > 0 ? body.lootValue / totalCost : null;
  var profitable = body.lootValue >= totalCost;
  var grade = "F";

  if (body.survived && multiplier !== null && netResult >= totalCost * 2) {
    grade = "S";
  } else if (body.survived && netResult >= totalCost) {
    grade = "A";
  } else if (body.survived && profitable && netResult > 0) {
    grade = "B";
  } else if (body.survived && Math.abs(netResult) <= Math.max(1, totalCost * 0.05)) {
    grade = "C";
  } else if (!body.survived && (body.lootValue > 0 || body.kills >= 3 || body.revives >= 2)) {
    grade = "D";
  }

  return {
    totalCost: totalCost,
    netResult: netResult,
    multiplier: multiplier,
    profitable: profitable,
    grade: grade
  };
}

function fallback(body, calc) {
  var title = "The Accountant";

  if (calc.grade === "S") title = "The Koen Printer";
  else if (calc.grade === "F" && !body.survived) title = "Expensive Spectator";
  else if (calc.grade === "D") title = "Insurance Fraud Specialist";
  else if (calc.netResult === 0) title = "Broke Even Legend";
  else if (body.kills >= 5) title = "The Lobby Problem";
  else if (calc.multiplier !== null && calc.multiplier >= 3) title = "Loot Goblin";

  var verdict = calc.netResult > 0
    ? "You turned the raid investment into a clean profit."
    : calc.netResult === 0
      ? "You escaped with your wallet exactly where it started."
      : "The loot did not cover the shopping spree.";

  if (body.tone === "funny" && calc.netResult > 0) {
    verdict = "The spreadsheet approves. Your squad may now request funding.";
  }

  if (body.tone === "savage" && calc.netResult < 0) {
    verdict = "A bold financial strategy. Unfortunately, the numbers disagree.";
  }

  return {
    title: title,
    verdict: verdict,
    squadMessage: body.kills + " kills, " + body.revives + " revives, and a grade " + calc.grade + " receipt."
  };
}

function validText(value, max) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

function validOutput(value) {
  return value &&
    validText(value.title, 40) &&
    validText(value.verdict, 220) &&
    validText(value.squadMessage, 220);
}

function clientIp(req) {
  var forwarded = req.headers && req.headers["x-forwarded-for"];
  var socketAddress = req.socket && req.socket.remoteAddress;
  return String(forwarded || socketAddress || "unknown").split(",")[0].trim();
}

function pruneHits(now) {
  hits.forEach(function (times, ip) {
    var active = times.filter(function (time) {
      return now - time < 60000;
    });

    if (active.length === 0) {
      hits.delete(ip);
    } else {
      hits.set(ip, active);
    }
  });

  if (hits.size > 10000) {
    var first = hits.keys().next();

    if (!first.done) {
      hits.delete(first.value);
    }
  }
}

async function providerText(body, base) {
  var provider = process.env.AI_PROVIDER;
  var key = provider === "gemini"
    ? process.env.GEMINI_API_KEY
    : provider === "groq"
      ? process.env.GROQ_API_KEY
      : "";

  if (!key) return base;

  var prompt =
    "Return JSON only with title, verdict, squadMessage. " +
    "Keep title under 40 characters and each other field under 220 characters. " +
    "Never change or calculate values. Be playful but not abusive. " +
    "Structured data: " + JSON.stringify(body);

  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, 7000);

  try {
    var response;
    var data;
    var text = "";

    if (provider === "gemini") {
      response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        encodeURIComponent(key),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          }),
          signal: controller.signal
        }
      );
    } else if (provider === "groq") {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.4,
          max_tokens: 180,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
    } else {
      return base;
    }

    if (!response.ok) return base;

    data = await response.json();

    if (provider === "gemini") {
      text =
        data &&
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text || "";
    } else {
      text =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content || "";
    }

    var parsed = JSON.parse(text);

    return validOutput(parsed) ? parsed : base;
  } catch (error) {
    return base;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  var allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (origin) {
      return origin.trim();
    })
    .filter(Boolean);

  var requestOrigin = req.headers && req.headers.origin;

  if (allowedOrigins.length > 0 && allowedOrigins.indexOf(requestOrigin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  var body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
  }

  if (!body || JSON.stringify(body).length > 12000 || !validBody(body)) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  var now = Date.now();
  pruneHits(now);

  var ip = clientIp(req);
  var previous = hits.get(ip) || [];
  previous = previous.filter(function (time) {
    return now - time < 60000;
  });

  if (previous.length >= 20) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }

  previous.push(now);
  hits.set(ip, previous);

  var calc = calculate(body);
  var base = fallback(body, calc);
  var result = await providerText(body, base);

  res.status(200).json(result);
};
