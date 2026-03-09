const https = require("https");
const http  = require("http");

const ALLOWED_HOST = "storing.ingv.it";

exports.handler = async function(event) {
  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return { statusCode: 400, body: "Parametro 'url' mancante" };
  }

  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return { statusCode: 400, body: "URL non valido" }; }

  if (parsed.hostname !== ALLOWED_HOST) {
    return { statusCode: 403, body: "Host non consentito" };
  }

  if (!parsed.pathname.endsWith(".pdf")) {
    return { statusCode: 403, body: "Solo file PDF consentiti" };
  }

  return new Promise((resolve) => {
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      rejectUnauthorized: false, // INGV ha catena SSL incompleta
      headers: { "User-Agent": "Fragmenta/1.0" },
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
          },
          body: buffer.toString("base64"),
          isBase64Encoded: true,
        });
      });
    });

    req.on("error", () => {
      resolve({ statusCode: 502, body: "Errore nel recupero del PDF" });
    });

    req.end();
  });
};