const TRANSLATOR_API_BASE_URL = "http://159.223.84.83:8000";
const ALLOWED_TRANSLATOR_MODELS = [
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "codex-mini",
];

function selectModel(mode, requireJson) {
  if (mode === "fast") return "codex-mini";
  if (requireJson || mode === "json" || mode === "batch") return "gpt-5.1-codex-max";
  return "gpt-5.2";
}

async function callChatCompletion(body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${TRANSLATOR_API_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Translation request failed with status ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry(requestFn) {
  try {
    return await requestFn();
  } catch (error) {
    return await requestFn();
  }
}

async function translateText(text, targetLang, mode) {
  const model = selectModel(mode, false);
  if (!ALLOWED_TRANSLATOR_MODELS.includes(model)) return text;
  try {
    const result = await withRetry(() =>
      callChatCompletion({
        model,
        messages: [
          { role: "system", content: `Translate the user's text into ${targetLang}.` },
          { role: "user", content: text },
        ],
      })
    );
    const choice = result?.choices?.[0]?.message?.content;
    return typeof choice === "string" && choice.trim() ? choice : text;
  } catch (_err) {
    return text;
  }
}

async function translateBatch(texts, targetLang, mode) {
  const model = selectModel(mode, true);
  if (!ALLOWED_TRANSLATOR_MODELS.includes(model)) return texts;
  try {
    const result = await withRetry(() =>
      callChatCompletion({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Translate each entry in the provided array into ${targetLang}. Return JSON with a \"translations\" array of translated strings in the same order.`,
          },
          { role: "user", content: JSON.stringify({ texts }) },
        ],
      })
    );
    const content = result?.choices?.[0]?.message?.content;
    if (!content) return texts;
    const parsed = JSON.parse(content);
    const translations = Array.isArray(parsed?.translations) ? parsed.translations : [];
    if (translations.length !== texts.length) return texts;
    return translations.map((t, i) => (typeof t === "string" && t.trim() ? t : texts[i]));
  } catch (_err) {
    return texts;
  }
}

async function translateImage(imageData, targetLang, mode, width, height) {
  const model = selectModel(mode, true);
  if (!ALLOWED_TRANSLATOR_MODELS.includes(model)) {
    return {
      translations: [
        {
          originalLanguage: "Unknown",
          translatedText: "Translation unavailable",
          minX: 0,
          minY: 0,
          maxX: width || 200,
          maxY: height || 200,
        },
      ],
    };
  }
  const imageContent = imageData && imageData.startsWith("data:") ? imageData : `data:image/png;base64,${imageData || ""}`;
  try {
    const result = await withRetry(() =>
      callChatCompletion({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `You translate manga images into ${targetLang}. Extract all readable text from the provided image and return translated text.` +
              " Respond strictly with JSON: {\"translations\":[{\"translatedText\":string,\"originalLanguage\":string,\"minX\":number,\"minY\":number,\"maxX\":number,\"maxY\":number}]}." +
              " Use bounding boxes normalized to the image if exact boxes are unknown, covering the entire image as a fallback.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Translate this image." },
              { type: "image_url", image_url: { url: imageContent } },
            ],
          },
        ],
      })
    );
    const content = result?.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty translation response");
    const parsed = JSON.parse(content);
    if (!parsed?.translations?.length) throw new Error("missing translations");
    return parsed;
  } catch (_err) {
    return {
      translations: [
        {
          originalLanguage: "Unknown",
          translatedText: "Translation unavailable",
          minX: 0,
          minY: 0,
          maxX: width || 200,
          maxY: height || 200,
        },
      ],
    };
  }
}

self.translatorClient = {
  translateText,
  translateBatch,
  translateImage,
};
