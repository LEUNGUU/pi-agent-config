import { execFileSync } from "node:child_process";
import type { CliArgs } from "../types";

const DEFAULT_MODEL = "stability.stable-image-ultra-v1:1";

export function getDefaultModel(): string {
  return process.env.BEDROCK_IMAGE_MODEL || DEFAULT_MODEL;
}

function getRegion(): string {
  return process.env.BEDROCK_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2";
}

function getProfile(): string | null {
  return process.env.BEDROCK_PROFILE || process.env.AWS_PROFILE || null;
}

function parseAspectRatio(ar: string | null): { width: number; height: number } {
  if (!ar) return { width: 1024, height: 1024 };
  const ratioMap: Record<string, { width: number; height: number }> = {
    "1:1":  { width: 1024, height: 1024 },
    "16:9": { width: 1344, height: 768 },
    "9:16": { width: 768, height: 1344 },
    "4:3":  { width: 1152, height: 896 },
    "3:4":  { width: 896, height: 1152 },
    "3:2":  { width: 1216, height: 832 },
    "2:3":  { width: 832, height: 1216 },
  };
  return ratioMap[ar] || { width: 1024, height: 1024 };
}

function isStabilityModel(model: string): boolean {
  return model.startsWith("stability.");
}

function isTitanModel(model: string): boolean {
  return model.includes("titan-image");
}

function isNovaModel(model: string): boolean {
  return model.includes("nova-canvas");
}

function buildRequestBody(prompt: string, model: string, args: CliArgs): string {
  const { width, height } = parseAspectRatio(args.aspectRatio);

  if (isStabilityModel(model)) {
    return JSON.stringify({
      prompt,
      output_format: "png",
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
    });
  }

  if (isNovaModel(model)) {
    return JSON.stringify({
      taskType: "TEXT_IMAGE",
      textToImageParams: { text: prompt },
      imageGenerationConfig: { numberOfImages: 1, width, height },
    });
  }

  if (isTitanModel(model)) {
    return JSON.stringify({
      taskType: "TEXT_IMAGE",
      textToImageParams: { text: prompt },
      imageGenerationConfig: { numberOfImages: 1, width, height },
    });
  }

  // Generic fallback — Stability-style
  return JSON.stringify({ prompt, output_format: "png" });
}

function extractImage(data: any, model: string): string {
  // Stability models
  if (data.images && Array.isArray(data.images) && data.images.length > 0) {
    return data.images[0];
  }
  // Nova / Titan models
  if (data.images && typeof data.images[0] === "string") {
    return data.images[0];
  }
  throw new Error(`No image found in Bedrock response for model ${model}`);
}

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs,
): Promise<Uint8Array> {
  const region = getRegion();
  const profile = getProfile();
  const body = buildRequestBody(prompt, model, args);
  const tmpOut = `/tmp/bedrock-out-${Date.now()}.json`;

  console.log(`Generating image with Bedrock (${model}, ${region})...`);

  const awsArgs = [
    "bedrock-runtime", "invoke-model",
    "--model-id", model,
    "--region", region,
    "--content-type", "application/json",
    "--cli-binary-format", "raw-in-base64-out",
    "--body", body,
    ...(profile ? ["--profile", profile] : []),
    tmpOut,
  ];

  try {
    execFileSync("aws", awsArgs, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    const detail = (typeof e.stderr === "string" ? e.stderr : e.message) || "aws cli failed";
    throw new Error(`Bedrock API error: ${detail.trim()}`);
  }

  const { readFile, unlink } = await import("node:fs/promises");
  const raw = await readFile(tmpOut, "utf8");
  await unlink(tmpOut).catch(() => {});

  const data = JSON.parse(raw);
  const b64 = extractImage(data, model);
  console.log("Generation completed.");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
