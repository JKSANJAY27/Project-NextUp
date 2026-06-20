/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GenerationProgress {
  status: "idle" | "loading" | "generating" | "success" | "error";
  progress?: number; // 0 to 100
  message?: string;
}

export type BrowserModelType = "gemini-nano" | "qwen-0.5b" | "llama-1b";

/**
 * Checks if window.ai (Gemini Nano) is available in the browser.
 */
export async function isGeminiNanoAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  
  try {
    const ai = (window as any).ai;
    if (!ai) return false;
    
    // Check if the languageModel API is available
    const lm = ai.languageModel || ai.assistant;
    if (!lm) return false;
    
    const capabilities = await lm.capabilities();
    return capabilities.available !== "no";
  } catch (e) {
    console.warn("Failed to check window.ai availability:", e);
    return false;
  }
}

/**
 * Generates text using window.ai (Gemini Nano).
 */
async function generateWithGeminiNano(
  prompt: string,
  onToken?: (text: string) => void
): Promise<string> {
  const ai = (window as any).ai;
  const lm = ai.languageModel || ai.assistant;
  
  const session = await lm.create({
    systemPrompt: "You are a professional placement assistant. Write high-quality, professional job application documents.",
  });
  
  try {
    if (typeof session.promptStreaming === "function") {
      let fullText = "";
      const stream = session.promptStreaming(prompt);
      for await (const chunk of stream) {
        fullText = chunk;
        if (onToken) {
          onToken(chunk);
        }
      }
      return fullText;
    } else {
      const response = await session.prompt(prompt);
      if (onToken) onToken(response);
      return response;
    }
  } finally {
    if (typeof session.destroy === "function") {
      session.destroy();
    }
  }
}

// Global cached pipeline generator to avoid downloading/re-initializing multiple times
let cachedGenerator: any = null;
let cachedModelName = "";

/**
 * Generates text using transformers.js (ONNX local WebAssembly).
 */
async function generateWithTransformers(
  modelName: string,
  prompt: string,
  maxTokens: number = 512,
  onProgress?: (progress: number) => void,
  onToken?: (text: string) => void
): Promise<string> {
  const { pipeline, env } = await import("@xenova/transformers");
  
  // Disable local models loading (fetching from local path)
  env.allowLocalModels = false;
  
  const globalObj = typeof window !== "undefined" ? (window as any) : {};

  if (typeof window !== "undefined") {
    if (!globalObj.__cachedGenerator || globalObj.__cachedModelName !== modelName) {
      globalObj.__cachedGenerator = await pipeline("text-generation", modelName, {
        progress_callback: (data: any) => {
          if (data.status === "progress" && onProgress) {
            onProgress(data.progress);
          }
          if (data.status === "ready" || data.status === "done") {
            try {
              localStorage.setItem(`model_downloaded_${modelName}`, "true");
            } catch {}
          }
        },
      });
      globalObj.__cachedModelName = modelName;
    }
    cachedGenerator = globalObj.__cachedGenerator;
    cachedModelName = globalObj.__cachedModelName;
  } else {
    if (!cachedGenerator || cachedModelName !== modelName) {
      cachedGenerator = await pipeline("text-generation", modelName, {});
      cachedModelName = modelName;
    }
  }

  // Format prompt for Qwen or Llama chat models
  let formattedPrompt = prompt;
  if (modelName.includes("Qwen")) {
    formattedPrompt = `<|im_start|>system\nYou are a professional placement assistant. Write high-quality, professional job application documents.<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
  }

  const output = await cachedGenerator(formattedPrompt, {
    max_new_tokens: maxTokens,
    temperature: 0.7,
    do_sample: true,
    callback_function: (beams: any) => {
      // Access current text from generation beams
      if (onToken && beams && beams[0]) {
        const decoded = cachedGenerator.tokenizer.decode(beams[0].output_token_ids, {
          skip_special_tokens: true,
        });
        // Just send the delta or full text. We'll send the full decoded text
        // because transformers.js yields full token ids array.
        onToken(decoded);
      }
    }
  });

  let result = Array.isArray(output) ? output[0].generated_text : output.generated_text;
  
  // Clean prompt output prefix if any
  if (result.startsWith(formattedPrompt)) {
    result = result.substring(formattedPrompt.length);
  }
  
  return result.trim();
}

/**
 * Dispatches the generative request to the appropriate browser-native or WASM LLM.
 */
export async function generateInBrowser({
  modelType,
  prompt,
  maxTokens,
  onProgress,
  onToken,
}: {
  modelType: BrowserModelType;
  prompt: string;
  maxTokens?: number;
  onProgress?: (progress: number) => void;
  onToken?: (text: string) => void;
}): Promise<string> {
  if (modelType === "gemini-nano") {
    const available = await isGeminiNanoAvailable();
    if (!available) {
      throw new Error("window.ai (Gemini Nano) is not available or enabled in this browser.");
    }
    return generateWithGeminiNano(prompt, onToken);
  } else if (modelType === "qwen-0.5b") {
    // Qwen 0.5B chat model - extremely fast and light (~350MB)
    return generateWithTransformers("Xenova/Qwen1.5-0.5B-Chat", prompt, maxTokens || 512, onProgress, onToken);
  } else if (modelType === "llama-1b") {
    // Llama 3.2 1B instruct (quantized ONNX community)
    return generateWithTransformers("onnx-community/Llama-3.2-1B-Instruct", prompt, maxTokens || 512, onProgress, onToken);
  } else {
    throw new Error(`Unsupported browser model type: ${modelType}`);
  }
}
