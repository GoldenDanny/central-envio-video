(() => {
  "use strict";

  const form = document.getElementById("uploadForm");
  const projectInput = document.getElementById("projectName");
  const whatsappInput = document.getElementById("whatsapp");
  const fileInput = document.getElementById("videoFiles");
  const selectedFilesBox = document.getElementById("selectedFiles");
  const feedback = document.getElementById("formFeedback");
  const submitButton = document.getElementById("submitButton");

  if (!form || !projectInput || !whatsappInput || !fileInput || !selectedFilesBox) {
    console.error("Central de Envio: não foi possível localizar os elementos do formulário.");
    return;
  }

  let selectedFiles = [];

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function syncInputFiles() {
    // Mantém a seleção acumulada no input, inclusive após remover arquivos.
    if (typeof DataTransfer === "undefined") return;
    const transfer = new DataTransfer();
    selectedFiles.forEach((file) => transfer.items.add(file));
    fileInput.files = transfer.files;
  }

  function renderFiles() {
    selectedFilesBox.replaceChildren();

    if (selectedFiles.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-files";
      empty.textContent = "Nenhum vídeo selecionado.";
      selectedFilesBox.appendChild(empty);
      return;
    }

    const heading = document.createElement("p");
    heading.className = "files-heading";
    heading.textContent = `${selectedFiles.length} vídeo(s) selecionado(s)`;
    selectedFilesBox.appendChild(heading);

    selectedFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "selected-file-item";

      const details = document.createElement("div");
      details.className = "selected-file-details";

      const name = document.createElement("strong");
      name.textContent = file.name;

      const size = document.createElement("span");
      size.textContent = formatBytes(file.size);

      details.append(name, size);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-file-button";
      remove.textContent = "Remover";
      remove.setAttribute("aria-label", `Remover ${file.name}`);
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        syncInputFiles();
        renderFiles();
        setFeedback("");
      });

      item.append(details, remove);
      selectedFilesBox.appendChild(item);
    });
  }

  function setFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
    feedback.classList.toggle("is-success", !isError && Boolean(message));
  }

  function normalizePhone(value) {
    return value.replace(/\D/g, "");
  }

  whatsappInput.addEventListener("input", () => {
    let digits = normalizePhone(whatsappInput.value).slice(0, 11);
    if (digits.length > 10) {
      digits = digits.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, "($1) $2-$3");
    } else if (digits.length > 6) {
      digits = digits.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    } else if (digits.length > 2) {
      digits = digits.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
    } else if (digits.length > 0) {
      digits = `(${digits}`;
    }
    whatsappInput.value = digits;
  });

  fileInput.addEventListener("change", () => {
    const incoming = Array.from(fileInput.files || []);
    const validVideos = incoming.filter((file) =>
      file.type.startsWith("video/") || /\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i.test(file.name)
    );

    const existingKeys = new Set(
      selectedFiles.map((file) => `${file.name}|${file.size}|${file.lastModified}`)
    );

    validVideos.forEach((file) => {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (!existingKeys.has(key)) {
        selectedFiles.push(file);
        existingKeys.add(key);
      }
    });

    if (validVideos.length !== incoming.length) {
      setFeedback("Alguns arquivos não eram vídeos e não foram adicionados.", true);
    } else {
      setFeedback("");
    }

    syncInputFiles();
    renderFiles();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setFeedback("");

    const project = projectInput.value.trim();
    const phoneDigits = normalizePhone(whatsappInput.value);

    if (!project) {
      projectInput.focus();
      setFeedback("Informe o Nome do Projeto.", true);
      return;
    }

    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      whatsappInput.focus();
      setFeedback("Informe um WhatsApp válido com DDD.", true);
      return;
    }

    if (selectedFiles.length === 0) {
      fileInput.focus();
      setFeedback("Selecione pelo menos um vídeo para continuar.", true);
      return;
    }

    // Nesta etapa apenas validamos os dados e a seleção.
    // O envio real ao Google Drive será conectado depois, com upload retomável.
    setFeedback(
      `Tudo certo! ${selectedFiles.length} vídeo(s) selecionado(s). O envio ao Google Drive será ativado na próxima etapa.`
    );
  });

  renderFiles();
})();
