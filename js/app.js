(function () {
  "use strict";

  var API_URL = typeof window.API_URL === "string" ? window.API_URL.trim() : "";
  var SITE_BASE = new URL(".", window.location.href).href;
  var busy = false;
  var latest = null;

  var form = document.getElementById("raid-form");
  var errorBox = document.getElementById("form-error");
  var button = document.getElementById("generate");
  var receipt = document.getElementById("receipt");
  var resultStatus = document.getElementById("result-status");

  var MAPS = ["Farm", "Valley", "Northridge", "Armory", "TV Station", "Port"];
  var MODES = ["Normal", "Lockdown", "Forbidden"];
  var TONES = ["tactical", "funny", "savage"];

  function integerField(id, min, max, required) {
    var element = document.getElementById(id);
    var raw = element.value.trim();

    if (!raw) {
      return required
        ? { valid: false, value: null, message: "This field is required." }
        : { valid: true, value: 0, message: "" };
    }

    var value = Number(raw);

    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      return {
        valid: false,
        value: null,
        message: "Enter a whole number from " + min.toLocaleString() + " to " + max.toLocaleString() + "."
      };
    }

    return { valid: true, value: value, message: "" };
  }

  function setFieldError(id, message) {
    var element = document.getElementById(id);
    var error = document.getElementById(id + "-error");

    if (!error) return;

    error.textContent = message || "";
    element.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function readInput() {
    var values = {
      loadoutCost: integerField("loadoutCost", 0, 999999999, true),
      extractedLoot: integerField("lootValue", 0, 999999999, true),
      ammoCost: integerField("ammoCost", 0, 999999999, false),
      consumableCost: integerField("consumableCost", 0, 999999999, false),
      entryCost: integerField("entryCost", 0, 999999999, false),
      kills: integerField("kills", 0, 99, false),
      assists: integerField("assists", 0, 99, false),
      revives: integerField("revives", 0, 99, false)
    };

    setFieldError("loadoutCost", values.loadoutCost.message);
    setFieldError("extractedLoot", values.extractedLoot.message);

    var firstInvalid = null;
    Object.keys(values).some(function (key) {
      if (!values[key].valid) {
        firstInvalid = key === "extractedLoot" ? "lootValue" : key;
        return true;
      }
      return false;
    });

    var playerName = document.getElementById("playerName").value.trim();

    if (playerName.length > 24) {
      if (!firstInvalid) firstInvalid = "playerName";
    }

    var input = {
      map: document.getElementById("map").value,
      mode: document.getElementById("mode").value,
      loadoutCost: values.loadoutCost.value,
      extractedLoot: values.extractedLoot.value,
      ammoCost: values.ammoCost.value,
      consumableCost: values.consumableCost.value,
      entryCost: values.entryCost.value,
      survived: document.querySelector("input[name='survived']:checked").value === "true",
      kills: values.kills.value,
      assists: values.assists.value,
      revives: values.revives.value,
      playerName: playerName.slice(0, 24),
      tone: document.getElementById("tone").value
    };

    return {
      valid: !firstInvalid,
      firstInvalid: firstInvalid,
      input: input
    };
  }

  function calculate(input) {
    var totalCost = input.loadoutCost + input.ammoCost + input.consumableCost + input.entryCost;
    var netResult = input.extractedLoot - totalCost;
    var multiplier = totalCost > 0 ? input.extractedLoot / totalCost : null;
    var profitable = input.extractedLoot >= totalCost;
    var grade = "F";

    if (input.survived && multiplier !== null && netResult >= totalCost * 2) {
      grade = "S";
    } else if (input.survived && netResult >= totalCost) {
      grade = "A";
    } else if (input.survived && profitable && netResult > 0) {
      grade = "B";
    } else if (input.survived && Math.abs(netResult) <= Math.max(1, totalCost * 0.05)) {
      grade = "C";
    } else if (!input.survived && (input.extractedLoot > 0 || input.kills >= 3 || input.revives >= 2)) {
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

  function fallbackCopy(calc, input) {
    var title = "The Accountant";

    if (calc.grade === "S") title = "The Koen Printer";
    else if (calc.grade === "F" && !input.survived) title = "Expensive Spectator";
    else if (calc.grade === "D") title = "Insurance Fraud Specialist";
    else if (calc.netResult === 0) title = "Broke Even Legend";
    else if (input.kills >= 5) title = "The Lobby Problem";
    else if (calc.multiplier !== null && calc.multiplier >= 3) title = "Loot Goblin";

    var verdict = calc.netResult > 0
      ? "You turned the raid investment into a clean profit."
      : calc.netResult === 0
        ? "You escaped the raid with your wallet exactly where it started."
        : "The receipt says the loot did not cover the shopping spree.";

    if (input.tone === "funny" && calc.netResult > 0) {
      verdict = "The spreadsheet approves. Your squad may now request funding.";
    }

    if (input.tone === "savage" && calc.netResult < 0) {
      verdict = "A bold financial strategy. Unfortunately, the numbers disagree.";
    }

    return {
      title: title,
      verdict: verdict,
      squadMessage: input.kills + " kills, " + input.revives + " revives, and a grade " + calc.grade + " receipt."
    };
  }

  function localResult(input) {
    var calc = calculate(input);
    return {
      input: input,
      calc: calc,
      copy: fallbackCopy(calc, input)
    };
  }

  function validRemote(data) {
    return data &&
      typeof data.title === "string" &&
      data.title.trim().length > 0 &&
      data.title.length <= 40 &&
      typeof data.verdict === "string" &&
      data.verdict.trim().length > 0 &&
      data.verdict.length <= 220 &&
      typeof data.squadMessage === "string" &&
      data.squadMessage.trim().length > 0 &&
      data.squadMessage.length <= 220;
  }

  async function requestAI(input, calc) {
    if (!API_URL) {
      throw new Error("AI endpoint is not configured");
    }

    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        map: input.map,
        mode: input.mode,
        survived: input.survived,
        loadoutCost: input.loadoutCost,
        ammoCost: input.ammoCost,
        consumableCost: input.consumableCost,
        entryCost: input.entryCost,
        totalCost: calc.totalCost,
        lootValue: input.extractedLoot,
        netResult: calc.netResult,
        multiplier: calc.multiplier,
        grade: calc.grade,
        kills: input.kills,
        assists: input.assists,
        revives: input.revives,
        tone: input.tone
      })
    });

    if (!response.ok) throw new Error("AI request failed");

    var data = await response.json();

    if (!validRemote(data)) {
      throw new Error("Invalid AI output");
    }

    return data;
  }

  function formatKoen(value) {
    return new Intl.NumberFormat("en-US").format(value) + " koen";
  }

  function render(result) {
    latest = result;

    document.getElementById("empty-state").classList.add("hidden");
    receipt.classList.remove("hidden");
    document.getElementById("receipt-title").textContent = result.copy.title;
    document.getElementById("grade").textContent = result.calc.grade;
    document.getElementById("receipt-route").textContent = result.input.map + " · " + result.input.mode;
    document.getElementById("survival").textContent = result.input.survived ? "SURVIVED" : "DID NOT EXTRACT";
    document.getElementById("total-cost").textContent = formatKoen(result.calc.totalCost);
    document.getElementById("loot").textContent = formatKoen(result.input.extractedLoot);
    document.getElementById("net").textContent =
      (result.calc.netResult >= 0 ? "+" : "−") + formatKoen(Math.abs(result.calc.netResult));
    document.getElementById("multiplier").textContent =
      result.calc.multiplier === null ? "N/A" : result.calc.multiplier.toFixed(2) + "×";
    document.getElementById("verdict").textContent = result.copy.verdict;
    document.getElementById("squad-message").textContent = result.copy.squadMessage;

    var bullets = [
      result.calc.profitable
        ? "PROFITABLE: loot covered the complete raid cost."
        : "LOSS: loot did not cover the complete raid cost.",
      result.input.kills + " kills · " + result.input.assists + " assists · " + result.input.revives + " revives.",
      result.input.survived
        ? "Extraction and profitability evaluated separately."
        : "Death did not automatically decide the financial result."
    ];

    var list = document.getElementById("bullets");
    list.textContent = "";

    bullets.forEach(function (text) {
      var item = document.createElement("li");
      item.textContent = text;
      list.appendChild(item);
    });

    resultStatus.textContent = "Raid receipt generated. Grade " + result.calc.grade + ".";
    receipt.focus();
  }

  function encodeBase64(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  function decodeBase64(value) {
    return decodeURIComponent(escape(atob(value)));
  }

  function encodedUrl(result) {
    var data = {
      v: 1,
      map: result.input.map,
      mode: result.input.mode,
      loadoutCost: result.input.loadoutCost,
      extractedLoot: result.input.extractedLoot,
      ammoCost: result.input.ammoCost,
      consumableCost: result.input.consumableCost,
      entryCost: result.input.entryCost,
      survived: result.input.survived,
      kills: result.input.kills,
      assists: result.input.assists,
      revives: result.input.revives,
      playerName: result.input.playerName,
      tone: result.input.tone
    };

    return SITE_BASE + "?d=" + encodeURIComponent(encodeBase64(JSON.stringify(data)));
  }

  function validSharedData(data) {
    return data &&
      data.v === 1 &&
      MAPS.indexOf(data.map) !== -1 &&
      MODES.indexOf(data.mode) !== -1 &&
      TONES.indexOf(data.tone) !== -1 &&
      typeof data.survived === "boolean";
  }

  function loadShared() {
    var raw = new URLSearchParams(window.location.search).get("d");

    if (!raw) return;

    try {
      var data = JSON.parse(decodeBase64(raw));

      if (!validSharedData(data)) {
        throw new Error("Invalid share data");
      }

      document.getElementById("map").value = data.map;
      document.getElementById("mode").value = data.mode;
      document.getElementById("loadoutCost").value = data.loadoutCost;
      document.getElementById("lootValue").value = data.extractedLoot;
      document.getElementById("ammoCost").value = data.ammoCost;
      document.getElementById("consumableCost").value = data.consumableCost;
      document.getElementById("entryCost").value = data.entryCost;
      document.getElementById("kills").value = data.kills;
      document.getElementById("assists").value = data.assists;
      document.getElementById("revives").value = data.revives;
      document.getElementById("playerName").value = data.playerName || "";
      document.getElementById("tone").value = data.tone;
      document.querySelector("input[name='survived'][value='" + (data.survived ? "true" : "false") + "']").checked = true;

      var result = readInput();

      if (!result.valid) {
        throw new Error("Invalid shared fields");
      }

      render(localResult(result.input));
    } catch (error) {
      errorBox.textContent = "This shared receipt could not be read.";
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();

    if (!document.execCommand("copy")) {
      throw new Error("Copy unavailable");
    }

    document.body.removeChild(area);
  }

  function copyFor(result) {
    var sign = result.calc.netResult >= 0 ? "+" : "−";
    var returnText = result.calc.multiplier === null ? "N/A" : result.calc.multiplier.toFixed(2) + "x";
    var name = result.input.playerName ? result.input.playerName + " · " : "";

    return "🧾 RAID RECEIPT\n" +
      name + result.input.map + " · " + result.input.mode + " · " +
      (result.input.survived ? "Survived" : "Died") + "\n" +
      "Loot: " + compact(result.input.extractedLoot) +
      " | Cost: " + compact(result.calc.totalCost) +
      " | Net: " + sign + compact(Math.abs(result.calc.netResult)) + "\n" +
      "Return: " + returnText +
      " | Grade: " + result.calc.grade + "\n" +
      "Title: " + result.copy.title + "\n" +
      "Create yours: " + SITE_BASE;
  }

  function compact(value) {
    var n = Math.abs(value);

    if (n >= 1000000) return (n / 1000000).toFixed(1) + "m";
    if (n >= 1000) return Math.round(n / 1000) + "k";
    return String(n);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (busy) return;

    var read = readInput();
    errorBox.textContent = "";

    if (!read.input.map || !read.input.mode) {
      errorBox.textContent = "Choose a map and mode.";
      document.getElementById("map").focus();
      return;
    }

    if (!read.valid) {
      errorBox.textContent = "Review the highlighted fields.";
      document.getElementById(read.firstInvalid).focus();
      return;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Generating…";

    var local = localResult(read.input);
    render(local);

    if (API_URL) {
      try {
        var remote = await requestAI(read.input, local.calc);
        local.copy.title = remote.title;
        local.copy.verdict = remote.verdict;
        local.copy.squadMessage = remote.squadMessage;
        render(local);
        errorBox.textContent = "Optional AI polish applied.";
      } catch (error) {
        errorBox.textContent = "Rules-only receipt ready.";
      }
    } else {
      errorBox.textContent = "Rules-only receipt ready.";
    }

    busy = false;
    button.disabled = false;
    button.textContent = "Generate Raid Receipt";
  });

  document.getElementById("copy").addEventListener("click", async function () {
    if (!latest) return;

    var original = this.textContent;

    try {
      await copyText(copyFor(latest));
      this.textContent = "Copied ✓";
    } catch (error) {
      errorBox.textContent = "Copy is unavailable. Select and copy the receipt text manually.";
    }

    setTimeout(function () {
      document.getElementById("copy").textContent = original;
    }, 1800);
  });

  document.getElementById("share").addEventListener("click", async function () {
    if (!latest) return;

    var url = encodedUrl(latest);
    var original = this.textContent;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "My RaidReceipt",
          text: latest.copy.title,
          url: url
        });
        this.textContent = "Shared ✓";
      } else {
        await copyText(url);
        this.textContent = "URL copied ✓";
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        errorBox.textContent = "The receipt URL could not be copied.";
      }
    }

    setTimeout(function () {
      document.getElementById("share").textContent = original;
    }, 1800);
  });

  document.getElementById("edit").addEventListener("click", function () {
    document.getElementById("map").focus();
    window.scrollTo({
      top: document.getElementById("calculator").offsetTop - 20,
      behavior: "smooth"
    });
  });

  document.getElementById("download").addEventListener("click", function () {
    if (!latest) return;

    var canvas = document.createElement("canvas");
    var width = 1200;
    var height = 760;
    var scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    canvas.width = width * scale;
    canvas.height = height * scale;

    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#10151d";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#c7f36b";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("RAIDRECEIPT ABI", 70, 75);

    ctx.fillStyle = "#edf2f4";
    ctx.font = "bold 58px sans-serif";
    ctx.fillText(latest.copy.title.slice(0, 28), 70, 165);

    ctx.font = "28px sans-serif";
    ctx.fillText(
      latest.input.map + " · " + latest.input.mode + " · " +
      (latest.input.survived ? "SURVIVED" : "DID NOT EXTRACT"),
      70,
      220
    );

    ctx.fillText("Total cost: " + formatKoen(latest.calc.totalCost), 70, 330);
    ctx.fillText("Loot: " + formatKoen(latest.input.extractedLoot), 70, 380);
    ctx.fillText(
      "Net: " +
      (latest.calc.netResult >= 0 ? "+" : "−") +
      formatKoen(Math.abs(latest.calc.netResult)),
      70,
      430
    );

    ctx.fillText(
      "Return: " +
      (latest.calc.multiplier === null ? "N/A" : latest.calc.multiplier.toFixed(2) + "x") +
      "   Grade: " + latest.calc.grade,
      70,
      480
    );

    ctx.fillStyle = "#b4c0c9";
    ctx.font = "24px sans-serif";
    ctx.fillText(latest.copy.verdict.slice(0, 85), 70, 575);
    ctx.fillText("caytec.github.io/raidreceipt-abi-mvp-20261118/", 70, 680);

    var link = document.createElement("a");
    link.download = "raidreceipt-card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  loadShared();
}());
