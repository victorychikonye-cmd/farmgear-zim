(function () {
  var $ = function (s) { return document.querySelector(s); };

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key) || "";
      localStorage.setItem(key, val);
    } catch (e) { return ""; }
    return "";
  }

  var state = { file: null, count: "8", length: "medium", captions: true, busy: false };
  var apiBase = store("clipai_api");
  var accessKey = store("clipai_key");

  $("#apiUrl").value = apiBase;
  $("#accessKey").value = accessKey;

  function base() { return apiBase.replace(/\/+$/, ""); }

  // settings
  $("#gearBtn").onclick = function () { $("#settings").classList.toggle("hidden"); };
  $("#saveSettings").onclick = function () {
    apiBase = $("#apiUrl").value.trim();
    accessKey = $("#accessKey").value;
    store("clipai_api", apiBase);
    store("clipai_key", accessKey);
    $("#settings").classList.add("hidden");
  };

  // chips
  function wireChips(sel, key) {
    var box = $(sel);
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      box.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("on"); });
      b.classList.add("on");
      state[key] = b.dataset.v;
    });
  }
  wireChips("#countChips", "count");
  wireChips("#lenChips", "length");

  $("#capSwitch").onclick = function () {
    state.captions = !state.captions;
    this.classList.toggle("on", state.captions);
  };

  // file picking
  function refreshGo() {
    $("#go").disabled = state.busy || !(state.file || $("#videoUrl").value.trim());
  }
  function setFile(f) {
    if (!f) return;
    state.file = f;
    $("#videoUrl").value = "";
    $("#fname").textContent = f.name + " (" + (f.size / 1048576).toFixed(1) + " MB)";
    refreshGo();
  }
  $("#videoUrl").addEventListener("input", function () {
    if (this.value.trim()) {
      state.file = null;
      $("#file").value = "";
      $("#fname").textContent = "";
    }
    refreshGo();
  });
  $("#file").onchange = function () { setFile(this.files[0]); };
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
  });

  // progress UI
  function showProgress(stage, pct, msg, isErr) {
    $("#progressCard").classList.remove("hidden");
    $("#stage").textContent = stage;
    $("#barFill").style.width = pct + "%";
    var m = $("#pmsg");
    m.textContent = msg || "";
    m.className = "msg" + (isErr ? " err" : "");
  }

  function fmt(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function renderClips(clips) {
    var box = $("#clips");
    box.innerHTML = "";
    clips.forEach(function (c, i) {
      var url = base() + c.url;
      var card = document.createElement("div");
      card.className = "card clip";

      var v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = url;

      var h = document.createElement("h3");
      h.textContent = (i + 1) + ". " + c.title;

      var p = document.createElement("p");
      p.textContent = c.reason;

      var meta = document.createElement("div");
      meta.className = "meta";
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "From " + fmt(c.start) + " to " + fmt(c.end);
      var a = document.createElement("a");
      a.className = "dl";
      a.href = url;
      a.download = "clip_" + (i + 1) + ".mp4";
      a.textContent = "Download";
      meta.appendChild(tag);
      meta.appendChild(a);

      card.appendChild(v);
      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(meta);
      box.appendChild(card);
    });
  }

  var STAGES = {
    queued: "Queued",
    downloading: "Downloading your video",
    transcribing: "Listening to your video",
    finding: "Finding the best moments",
    cutting: "Creating clips",
    done: "Finished",
    error: "Something went wrong"
  };

  function poll(jobId) {
    var shown = 0;
    function tick() {
      fetch(base() + "/api/jobs/" + jobId)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          showProgress(STAGES[j.stage] || "Working", j.progress || 0, j.message, j.stage === "error");
          if (j.clips && j.clips.length !== shown) {
            shown = j.clips.length;
            renderClips(j.clips);
          }
          if (j.stage === "done" || j.stage === "error") {
            state.busy = false;
            refreshGo();
            return;
          }
          setTimeout(tick, 2500);
        })
        .catch(function () {
          showProgress("Connection problem", 0, "Could not reach the server. Retrying...", true);
          setTimeout(tick, 4000);
        });
    }
    tick();
  }

  // upload
  $("#go").onclick = function () {
    var link = $("#videoUrl").value.trim();
    if ((!state.file && !link) || state.busy) return;
    state.busy = true;
    this.disabled = true;
    $("#clips").innerHTML = "";

    var fd = new FormData();
    if (link) fd.append("url", link);
    else fd.append("file", state.file);
    fd.append("clips", state.count);
    fd.append("length", state.length);
    fd.append("captions", state.captions ? "true" : "false");

    var xhr = new XMLHttpRequest();
    xhr.open("POST", base() + "/api/jobs");
    if (accessKey) xhr.setRequestHeader("X-Access-Key", accessKey);

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        showProgress("Uploading", Math.min(pct * 0.05 * 2, 10), pct + "% uploaded");
      }
    };
    xhr.onload = function () {
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.job_id) {
        poll(data.job_id);
      } else {
        state.busy = false;
        refreshGo();
        showProgress("Could not start", 0, data.detail || ("Server error " + xhr.status), true);
      }
    };
    xhr.onerror = function () {
      state.busy = false;
      refreshGo();
      showProgress("Upload failed", 0, "Could not reach the server. Check the server address in Settings.", true);
    };
    showProgress(link ? "Starting" : "Uploading", 0, link ? "Sending your link..." : "Starting upload...");
    xhr.send(fd);
  };
})();
