/**
 * Client-side wrapper around /api/weather. Never rejects — any failure
 * (network down, bad payload, timeout) resolves to a plausible mock Taipei
 * reading instead.
 */
import type { Weather } from "@/game/types";
import { WEATHER_CITY } from "@/lib/config";

const FETCH_TIMEOUT_MS = 5000;

function mockTaipeiWeather(): Weather {
  return {
    city: WEATHER_CITY,
    tempC: 29,
    rainProb: 20,
    windKph: 12,
    condition: "Partly Cloudy",
    isMock: true,
  };
}

function isWeather(value: unknown): value is Weather {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.city === "string" &&
    typeof v.tempC === "number" &&
    typeof v.rainProb === "number" &&
    typeof v.windKph === "number" &&
    typeof v.condition === "string" &&
    typeof v.isMock === "boolean"
  );
}

export async function fetchWeather(): Promise<Weather> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;

  try {
    const res = await fetch("/api/weather", { signal: controller ? controller.signal : undefined });
    if (!res.ok) throw new Error(`weather request failed with status ${res.status}`);
    const data: unknown = await res.json();
    if (!isWeather(data)) throw new Error("malformed weather payload");
    return data;
  } catch (err) {
    console.error("[ai/weather] fetchWeather failed — using mock reading:", err);
    return mockTaipeiWeather();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
