const MAX_BYTES = 20 * 1024 * 1024;

const FAQ_ITEMS = [
  {
    q: "Is the image converter really free?",
    a: "Yes. There is no payment, subscription, or hidden fees. You can convert images directly in your browser at no cost.",
  },
  {
    q: "Are my images safe and secure?",
    a: "Your files are processed locally in your browser. They are not uploaded to our servers, which keeps your data on your device.",
  },
  {
    q: "What is the maximum file size I can convert?",
    a: "You can convert image files up to 20 MB each. Larger files are blocked to keep the tool responsive in the browser.",
  },
  {
    q: "Which image formats are supported?",
    a: "We support all popular image formats including JPG, PNG, WEBP, GIF, BMP, and more. You can convert between any of these formats.",
  },
  {
    q: "Can I batch convert multiple images at once?",
    a: "Currently the tool converts one image at a time. You can repeat the process for each file you need.",
  },
  {
    q: "Will the conversion affect image quality?",
    a: "For JPEG and WEBP you can adjust quality. PNG and BMP are lossless for typical use. Resizing always changes pixels, so very small dimensions may look softer.",
  },
];

const OUTPUT_FORMATS = [
  { value: "png", label: "PNG", mime: "image/png", ext: "png" },
  { value: "jpeg", label: "JPEG", mime: "image/jpeg", ext: "jpg" },
  { value: "webp", label: "WEBP", mime: "image/webp", ext: "webp" },
  { value: "bmp", label: "BMP", mime: "image/bmp", ext: "bmp" },
  { value: "svg", label: "SVG (raster inside)", mime: "image/svg+xml", ext: "svg" },
  { value: "pdf", label: "PDF (1 page)", mime: "application/pdf", ext: "pdf" },
];

function supportsWebp() {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  return c.toDataURL("image/webp").indexOf("data:image/webp") === 0;
}

function initFaq() {
  const root = document.getElementById("accordion");
  if (!root) return;

  FAQ_ITEMS.forEach((item, i) => {
    const wrap = document.createElement("div");
    wrap.className = "accordion-item";
    if (i === 3) wrap.classList.add("is-open");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "accordion-trigger";
    btn.setAttribute("aria-expanded", i === 3 ? "true" : "false");
    btn.innerHTML = `<span>${escapeHtml(item.q)}</span><svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    const panel = document.createElement("div");
    panel.className = "accordion-panel";
    panel.id = `faq-panel-${i}`;
    panel.textContent = item.a;
    btn.setAttribute("aria-controls", panel.id);

    btn.addEventListener("click", () => {
      const open = !wrap.classList.contains("is-open");
      root.querySelectorAll(".accordion-item").forEach((el) => {
        el.classList.remove("is-open");
        el.querySelector(".accordion-trigger")?.setAttribute("aria-expanded", "false");
      });
      if (open) {
        wrap.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    root.appendChild(wrap);
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function imageBitmapToCanvas(bitmap, maxW, maxH, fillWhite) {
  let w = bitmap.width;
  let h = bitmap.height;
  if (maxW || maxH) {
    const mw = maxW ? Number(maxW) : Infinity;
    const mh = maxH ? Number(maxH) : Infinity;
    if (w > mw || h > mh) {
      const r = Math.min(mw / w, mh / h, 1);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (fillWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

function canvasToBmpBlob(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const rowSize = ((width * 3 + 3) >> 2) << 2;
  const pixelArraySize = rowSize * height;
  const fileSize = 14 + 40 + pixelArraySize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);

  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 14 + 40, true);

  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  const data = imageData.data;
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    let rowOffset = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      view.setUint8(offset + rowOffset++, data[i + 2]);
      view.setUint8(offset + rowOffset++, data[i + 1]);
      view.setUint8(offset + rowOffset++, data[i + 0]);
    }
    while (rowOffset < rowSize) {
      view.setUint8(offset + rowOffset++, 0);
    }
    offset += rowSize;
  }

  return new Blob([buf], { type: "image/bmp" });
}

function canvasToSvgDataUrl(canvas) {
  const png = canvas.toDataURL("image/png");
  const w = canvas.width;
  const h = canvas.height;
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image href="${png}" width="100%" height="100%"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function baseName(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function main() {
  initFaq();

  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const emptyState = document.getElementById("emptyState");
  const activeState = document.getElementById("activeState");
  const btnPick = document.getElementById("btnPickFile");
  const btnClear = document.getElementById("btnClear");
  const btnConvert = document.getElementById("btnConvert");
  const previewThumb = document.getElementById("previewThumb");
  const fileNameEl = document.getElementById("fileName");
  const fileSizeEl = document.getElementById("fileSize");
  const errorMsg = document.getElementById("errorMsg");
  const outFormat = document.getElementById("outFormat");
  const quality = document.getElementById("quality");
  const qualityVal = document.getElementById("qualityVal");
  const qualityWrap = document.getElementById("qualityWrap");
  const maxWidth = document.getElementById("maxWidth");
  const maxHeight = document.getElementById("maxHeight");

  let currentFile = null;
  let currentObjectUrl = null;
  let currentBitmap = null;

  const webpOk = supportsWebp();
  OUTPUT_FORMATS.forEach((f) => {
    if (f.value === "webp" && !webpOk) return;
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    outFormat.appendChild(opt);
  });
  if (!webpOk && outFormat.querySelector('option[value="webp"]') === null) {
    const opt = document.createElement("option");
    opt.value = "webp";
    opt.textContent = "WEBP (not supported)";
    opt.disabled = true;
    outFormat.appendChild(opt);
  }

  function showError(text) {
    errorMsg.textContent = text;
    errorMsg.classList.remove("hidden");
  }

  function clearError() {
    errorMsg.textContent = "";
    errorMsg.classList.add("hidden");
  }

  function setQualityVisibility() {
    const v = outFormat.value;
    const show = v === "jpeg" || v === "webp";
    qualityWrap.classList.toggle("hidden", !show);
  }

  outFormat.addEventListener("change", setQualityVisibility);
  quality.addEventListener("input", () => {
    qualityVal.textContent = quality.value;
  });

  function resetFile() {
    currentFile = null;
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    currentBitmap = null;
    previewThumb.innerHTML = "";
    dropZone.dataset.state = "empty";
    emptyState.classList.remove("hidden");
    activeState.classList.add("hidden");
    fileInput.value = "";
    clearError();
  }

  async function loadFile(file) {
    clearError();
    if (!file || !file.type.startsWith("image/")) {
      showError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError("File is larger than 20 MB.");
      return;
    }

    resetFile();
    currentFile = file;
    currentObjectUrl = URL.createObjectURL(file);

    try {
      currentBitmap = await createImageBitmap(file);
    } catch {
      showError("Could not read this image. Try another format.");
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
      currentFile = null;
      return;
    }

    const img = document.createElement("img");
    img.src = currentObjectUrl;
    img.alt = "";
    previewThumb.appendChild(img);
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    dropZone.dataset.state = "active";
    emptyState.classList.add("hidden");
    activeState.classList.remove("hidden");
    setQualityVisibility();
  }

  btnPick.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
  });
  btnClear.addEventListener("click", resetFile);

  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.dataset.drag = "over";
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "drop") {
        const f = e.dataTransfer?.files?.[0];
        if (f) loadFile(f);
      }
      delete dropZone.dataset.drag;
    });
  });

  btnConvert.addEventListener("click", async () => {
    clearError();
    if (!currentBitmap || !currentFile) {
      showError("Select an image first.");
      return;
    }

    const fmt = outFormat.value;
    if (fmt === "webp" && !webpOk) {
      showError("WEBP export is not supported in this browser.");
      return;
    }

    const mw = maxWidth.value.trim();
    const mh = maxHeight.value.trim();
    const fillWhite = fmt !== "png";
    const canvas = imageBitmapToCanvas(currentBitmap, mw || null, mh || null, fillWhite);
    const stem = baseName(currentFile.name);
    const q = Number(quality.value) / 100;

    try {
      if (fmt === "png") {
        canvas.toBlob(
          (blob) => {
            if (!blob) return showError("PNG export failed.");
            downloadBlob(blob, `${stem}.png`);
          },
          "image/png"
        );
        return;
      }

      if (fmt === "jpeg") {
        canvas.toBlob(
          (blob) => {
            if (!blob) return showError("JPEG export failed.");
            downloadBlob(blob, `${stem}.jpg`);
          },
          "image/jpeg",
          q
        );
        return;
      }

      if (fmt === "webp") {
        canvas.toBlob(
          (blob) => {
            if (!blob) return showError("WEBP export failed.");
            downloadBlob(blob, `${stem}.webp`);
          },
          "image/webp",
          q
        );
        return;
      }

      if (fmt === "bmp") {
        const blob = canvasToBmpBlob(canvas);
        downloadBlob(blob, `${stem}.bmp`);
        return;
      }

      if (fmt === "svg") {
        const url = canvasToSvgDataUrl(canvas);
        downloadDataUrl(url, `${stem}.svg`);
        return;
      }

      if (fmt === "pdf") {
        const JsPDF = window.jspdf?.jsPDF;
        if (!JsPDF) {
          showError("PDF library failed to load. Check your network.");
          return;
        }
        const dataUrl = canvas.toDataURL("image/png");
        const orientation = canvas.width >= canvas.height ? "l" : "p";
        const pdf = new JsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
        pdf.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(`${stem}.pdf`);
        return;
      }
    } catch (err) {
      showError(err?.message || "Conversion failed.");
    }
  });

  setQualityVisibility();
}

main();
