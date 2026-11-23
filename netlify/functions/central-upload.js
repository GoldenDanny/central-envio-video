/**
 * Netlify Function: central-upload
 *
 * Variáveis de ambiente obrigatórias no Netlify:
 * APPS_SCRIPT_URL = URL /exec do Web App publicado
 * CENTRAL_NETLIFY_SHARED_SECRET = mesmo segredo salvo nas propriedades do Apps Script
 * ALLOWED_ORIGIN = domínio do site publicado (ex.: https://seu-site.netlify.app)
 *
 * O segredo nunca é enviado ao navegador.
 */

exports.handler = async (event) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "";
  const requestOrigin = event.headers.origin || event.headers.Origin || "";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin || requestOrigin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (allowedOrigin && requestOrigin && requestOrigin !== allowedOrigin) {
    return reply(403, { sucesso: false, erro: "Origem não autorizada." }, corsHeaders);
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { sucesso: false, erro: "Método não permitido." }, corsHeaders);
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  const sharedSecret = process.env.CENTRAL_NETLIFY_SHARED_SECRET;

  if (!appsScriptUrl || !sharedSecret) {
    return reply(500, {
      sucesso: false,
      erro: "Integração não configurada no Netlify."
    }, corsHeaders);
  }

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { sucesso: false, erro: "JSON inválido." }, corsHeaders);
  }

  const allowedActions = new Set(["prepare", "complete"]);
  if (!allowedActions.has(input.action)) {
    return reply(400, { sucesso: false, erro: "Ação inválida." }, corsHeaders);
  }

  // Validação básica antes de encaminhar ao Apps Script.
  if (input.action === "prepare") {
    const name = String(input.nomeProjeto || "").trim();
    const phone = String(input.whatsapp || "").replace(/\D/g, "");
    const fileName = String(input.nomeArquivo || "").trim();
    const size = Number(input.tamanho);
    const mime = String(input.mimeType || "");

    if (!name || name.length > 120 || phone.length < 10 || phone.length > 11 ||
        !fileName || !Number.isFinite(size) || size <= 0 ||
        (!mime.startsWith("video/") && !/\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i.test(fileName))) {
      return reply(400, { sucesso: false, erro: "Dados do vídeo ou do projeto inválidos." }, corsHeaders);
    }
  }

  if (input.action === "complete") {
    if (!input.fileId || !input.nomeProjeto || !input.whatsapp) {
      return reply(400, { sucesso: false, erro: "Dados de conclusão incompletos." }, corsHeaders);
    }
  }

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, sharedSecret })
    });

    const text = await upstream.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return reply(502, {
        sucesso: false,
        erro: "O Apps Script retornou uma resposta inesperada."
      }, corsHeaders);
    }

    return reply(upstream.ok && data.sucesso ? 200 : 400, data, corsHeaders);

  } catch (error) {
    return reply(502, {
      sucesso: false,
      erro: "Não foi possível comunicar com o Google Apps Script."
    }, corsHeaders);
  }
};

function reply(statusCode, data, headers) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(data)
  };
}
