(() => {
  "use strict";

  const API_URL = "/.netlify/functions/central-upload";
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB; múltiplo de 256 KiB
  const MAX_RETRIES = 3;

  const form = document.getElementById("uploadForm");
  const projectInput = document.getElementById("projectName");
  const whatsappInput = document.getElementById("whatsapp");
  const fileInput = document.getElementById("videoFiles");
  const selectedFilesBox = document.getElementById("selectedFiles");
  const feedback = document.getElementById("formFeedback");
  const submitButton = document.getElementById("submitButton");

  if (!form || !projectInput || !whatsappInput || !fileInput || !selectedFilesBox || !feedback || !submitButton) {
    console.error("Central de Envio: não foi possível localizar os elementos do formulário.");
    return;
  }

  let selectedFiles = [];
  let isUploading = false;

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileKey(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function syncInputFiles() {
    if (typeof DataTransfer === "undefined") return;
    const transfer = new DataTransfer();
    selectedFiles.forEach((file) => transfer.items.add(file));
    fileInput.files = transfer.files;
  }

  function setFeedback(message, isError = false) {
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
    feedback.classList.toggle("is-success", !isError && Boolean(message));
  }

  function setBusy(busy) {
    isUploading = busy;
    submitButton.disabled = busy;
    projectInput.disabled = busy;
    whatsappInput.disabled = busy;
    fileInput.disabled = busy;
    submitButton.innerHTML = busy
      ? '<span aria-hidden="true">⏳</span> Enviando vídeos...'
      : '<span aria-hidden="true">➤</span> Continuar para envio';
    submitButton.style.opacity = busy ? ".75" : "1";
    submitButton.style.cursor = busy ? "wait" : "pointer";
  }

  function updateFileProgress(file, percent, status) {
    const key = fileKey(file);
    const item = Array.from(selectedFilesBox.querySelectorAll(".selected-file-item"))
      .find((element) => element.dataset.fileKey === key);
    if (!item) return;
    const progress = item.querySelector("progress");
    const label = item.querySelector(".upload-file-status");
    if (progress) progress.value = Math.max(0, Math.min(100, percent));
    if (label) label.textContent = status;
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
      item.dataset.fileKey = fileKey(file);

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
      remove.disabled = isUploading;
      remove.setAttribute("aria-label", `Remover ${file.name}`);
      remove.addEventListener("click", () => {
        if (isUploading) return;
        selectedFiles.splice(index, 1);
        syncInputFiles();
        renderFiles();
        setFeedback("");
      });

      const progressWrap = document.createElement("div");
      progressWrap.style.cssText = "margin-top:9px;width:100%;";
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = 0;
      progress.style.cssText = "width:100%;height:9px;accent-color:#8d36bd;display:block;";
      const status = document.createElement("small");
      status.className = "upload-file-status";
      status.style.cssText = "display:block;margin-top:4px;color:#75677f;font-size:11px;";
      status.textContent = "Aguardando envio";
      progressWrap.append(progress, status);

      item.append(details, remove, progressWrap);
      selectedFilesBox.appendChild(item);
    });
  }

  function normalizePhone(value) {
    return value.replace(/\D/g, "");
  }

  async function readJsonResponse(response, context) {
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${context}: resposta inesperada do servidor (HTTP ${response.status}).`);
    }
    if (!response.ok || data.sucesso === false) {
      throw new Error(data.erro || data.mensagem || `${context}: erro HTTP ${response.status}.`);
    }
    return data;
  }

  async function callBackend(payload) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return readJsonResponse(response, "Não foi possível preparar o envio");
  }

  function getNextOffset(rangeHeader, fallback) {
    if (!rangeHeader) return fallback;
    const match = String(rangeHeader).match(/bytes=0-(\d+)/i);
    return match ? Number(match[1]) + 1 : 0;
  }

  async function queryUploadOffset(sessionUrl, fileSize) {
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${fileSize}` }
    });

    if (response.status === 200 || response.status === 201) {
      return { completed: true, file: await response.json() };
    }
    if (response.status !== 308) {
      throw new Error(`Não foi possível consultar o andamento do vídeo (HTTP ${response.status}).`);
    }
    return { completed: false, offset: getNextOffset(response.headers.get("Range"), 0) };
  }

  async function uploadToDrive(sessionUrl, file, onProgress) {
    let offset = 0;

    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const chunk = file.slice(offset, end);
      let response = null;
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          response = await fetch(sessionUrl, {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`
            },
            body: chunk
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
          }
        }
      }

      if (lastError) {
        // Após uma falha de rede, consulta o Drive para não reenviar bytes já aceitos.
        const status = await queryUploadOffset(sessionUrl, file.size);
        if (status.completed) return status.file;
        offset = status.offset;
        if (offset >= file.size) continue;
        onProgress(offset / file.size * 100, `Retomando em ${Math.round(offset / file.size * 100)}%`);
        continue;
      }

      if (response.status === 200 || response.status === 201) {
        onProgress(100, "Upload concluído; registrando na planilha...");
        return await response.json();
      }

      if (response.status === 308) {
        const range = response.headers.get("Range");
        let nextOffset = getNextOffset(range, end);
        if (!range) {
          const status = await queryUploadOffset(sessionUrl, file.size);
          if (status.completed) return status.file;
          nextOffset = status.offset;
        }
        if (nextOffset <= offset && nextOffset < file.size) {
          throw new Error("O Google Drive não confirmou o avanço do vídeo. Tente novamente.");
        }
        offset = nextOffset;
        onProgress(offset / file.size * 100, `Enviado ${Math.round(offset / file.size * 100)}%`);
        continue;
      }

      const detail = await response.text().catch(() => "");
      throw new Error(`Falha ao enviar ${file.name} (HTTP ${response.status}). ${detail.slice(0, 220)}`);
    }

    const status = await queryUploadOffset(sessionUrl, file.size);
    if (status.completed) return status.file;
    throw new Error(`O envio de ${file.name} não foi finalizado pelo Google Drive.`);
  }

  async function uploadOneFile(file, project, phone) {
    updateFileProgress(file, 0, "Preparando conexão segura...");
    const prepared = await callBackend({
      action: "prepare",
      nomeProjeto: project,
      whatsapp: phone,
      nomeArquivo: file.name,
      mimeType: file.type || "application/octet-stream",
      tamanho: file.size
    });

    const session = prepared.resultado || prepared;
    if (!session.sessionUrl) {
      throw new Error("O servidor não retornou a sessão segura do Google Drive.");
    }

    const driveFile = await uploadToDrive(session.sessionUrl, file, (percent, status) => {
      updateFileProgress(file, percent, status);
    });

    if (!driveFile || !driveFile.id) {
      throw new Error("O Google Drive não confirmou o arquivo enviado.");
    }

    updateFileProgress(file, 100, "Vídeo recebido; salvando registro...");
    await callBackend({
      action: "complete",
      fileId: driveFile.id,
      nomeProjeto: project,
      whatsapp: phone
    });
    updateFileProgress(file, 100, "Concluído e registrado no Google Drive");
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
    if (isUploading) return;
    const incoming = Array.from(fileInput.files || []);
    const validVideos = incoming.filter((file) =>
      file.type.startsWith("video/") || /\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i.test(file.name)
    );

    const existingKeys = new Set(selectedFiles.map(fileKey));
    validVideos.forEach((file) => {
      const key = fileKey(file);
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isUploading) return;
    setFeedback("");

    const project = projectInput.value.trim();
    const phone = normalizePhone(whatsappInput.value);

    if (!project) {
      projectInput.focus();
      setFeedback("Informe o Nome do Projeto.", true);
      return;
    }
    if (phone.length < 10 || phone.length > 11) {
      whatsappInput.focus();
      setFeedback("Informe um WhatsApp válido com DDD.", true);
      return;
    }
    if (selectedFiles.length === 0) {
      fileInput.focus();
      setFeedback("Selecione pelo menos um vídeo para continuar.", true);
      return;
    }

    const filesToUpload = [...selectedFiles];
    setBusy(true);
    renderFiles();
    setFeedback(`Iniciando envio de ${filesToUpload.length} vídeo(s). Não feche esta página até terminar.`);

    let completed = 0;
    try {
      for (const file of filesToUpload) {
        setFeedback(`Enviando ${completed + 1} de ${filesToUpload.length}: ${file.name}`);
        await uploadOneFile(file, project, phone);
        completed += 1;
        // Remove da fila o vídeo já concluído para evitar duplicá-lo
        // caso outro arquivo falhe e o cliente precise tentar novamente.
        selectedFiles = selectedFiles.filter((item) => fileKey(item) !== fileKey(file));
        syncInputFiles();
        renderFiles();
      }

      setFeedback(`Pronto! ${completed} vídeo(s) enviado(s) e registrado(s) no Google Drive.`, false);
      form.reset();
    } catch (error) {
      console.error("Erro no envio da Central:", error);
      setFeedback(`O envio foi interrompido após ${completed} vídeo(s). ${error.message} Os arquivos já concluídos permanecem salvos. Você pode tentar novamente os que faltaram.`, true);
    } finally {
      setBusy(false);
      renderFiles();
    }
  });

  renderFiles();
})();
