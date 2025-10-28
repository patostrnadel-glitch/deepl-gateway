(function () {
  if (typeof TvorAIHeygenConfig === "undefined") {
    console.error("TvorAIHeygenConfig nie je definovaný.");
    return;
  }

  const API_BASE = TvorAIHeygenConfig.apiBase; // Render backend (Node)
  const AJAX_URL = TvorAIHeygenConfig.ajaxUrl; // admin-ajax.php
  const POLL_INTERVAL = TvorAIHeygenConfig.pollInterval || 3000;

  const btn = document.getElementById("tvorai_generate_btn");
  const statusBox = document.getElementById("tvorai_status");
  const resultBox = document.getElementById("tvorai_result");

  if (!btn || !statusBox || !resultBox) {
    return;
  }

  async function startBackendFlow() {
    const scriptText = document.getElementById("tvorai_script").value || "";
    const avatarId   = document.getElementById("tvorai_avatar").value || "";
    const voiceId    = document.getElementById("tvorai_voice").value || "";

    const formData = new FormData();
    formData.append("action", "lyra_consume_and_generate_video");
    formData.append("scriptText", scriptText);
    formData.append("avatarId", avatarId);
    formData.append("voiceId", voiceId);

    const res = await fetch(AJAX_URL, {
        method: "POST",
        body: formData
    });

    const json = await res.json();
    return json;
  }

  async function pollStatus(jobId) {
    return new Promise((resolve, reject) => {
      let timerId = null;

      async function check() {
        try {
          const res = await fetch(
            API_BASE + "/heygen-video/status/" + encodeURIComponent(jobId),
            { method: "GET" }
          );
          const json = await res.json();

          statusBox.textContent = "Stav renderu: " + json.status + " ...";

          if (json.status === "completed" && json.videoUrl) {
            clearInterval(timerId);
            resolve(json);
            return;
          }

          if (json.status === "failed") {
            clearInterval(timerId);
            reject(new Error("Render zlyhal."));
            return;
          }

        } catch (err) {
          clearInterval(timerId);
          reject(err);
          return;
        }
      }

      check();
      timerId = setInterval(check, POLL_INTERVAL);
    });
  }

  async function handleGenerateClick() {
    resultBox.innerHTML = "";
    statusBox.textContent = "Overujem kredity a spúšťam render...";

    // 1. WP → /consume → /heygen-video/generate
    let flowResp;
    try {
      flowResp = await startBackendFlow();
    } catch (err) {
      console.error("AJAX flow error", err);
      statusBox.textContent = "Chyba pri vytváraní videa.";
      return;
    }

    if (!flowResp.ok) {
        console.warn("Flow response:", flowResp);

        if (flowResp.error === "NOT_LOGGED_IN") {
            statusBox.textContent = "Musíš byť prihlásený.";
        } else if (flowResp.error === "NO_ACTIVE_SUBSCRIPTION") {
            statusBox.textContent = "Nemáš aktívne predplatné.";
        } else if (flowResp.error === "INSUFFICIENT_CREDITS") {
            statusBox.textContent = "Nedostatok kreditov.";
        } else {
            statusBox.textContent = "Nedá sa vygenerovať video (" + flowResp.error + ").";
        }
        return;
    }

    const jobId = flowResp.jobId;
    if (!jobId) {
        statusBox.textContent = "Server nevrátil jobId.";
        return;
    }

    statusBox.textContent = "Renderujem video... (" + jobId + ")";

    // 2. poll status priamo na Node API
    try {
      const finalStatus = await pollStatus(jobId);

      statusBox.textContent = "Hotovo 🚀";
      resultBox.innerHTML =
        '<video controls style="max-width:100%;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.2);" src="' +
        finalStatus.videoUrl +
        '"></video>';
    } catch (err) {
      console.error("poll error", err);
      statusBox.textContent = "Video sa nepodarilo vyrenderovať.";
    }
  }

  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.style.cursor = "not-allowed";

    handleGenerateClick().finally(() => {
      btn.disabled = false;
      btn.style.opacity = "";
      btn.style.cursor = "pointer";
    });
  });
})();
