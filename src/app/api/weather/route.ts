/**
 * Proxies Open-Meteo (no key, no signup) for the configured city. Any
 * failure — network, bad payload, non-200 — returns a plausible mock Taipei
 * reading with isMock: true and HTTP 200. Never 500s: the demo must never
 * break because of the network.
 */
import { NextResponse } from "next/server";
import { WEATHER_CITY, WEATHER_LAT, WEATHER_LON } from "@/lib/config";
import type { Weather } from "@/game/types";

const WEATHER_CODE_MAP: Record<number, string> = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  56: "Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Light Showers",
  81: "Showers",
  82: "Violent Showers",
  85: "Snow Showers",
  86: "Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm, Hail",
  99: "Thunderstorm, Hail",
};

function mockWeather(): Weather {
  return {
    city: WEATHER_CITY,
    tempC: 29,
    rainProb: 20,
    windKph: 12,
    condition: "Partly Cloudy",
    isMock: true,
  };
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  hourly?: {
    time?: string[];
    precipitation_probability?: number[];
  };
}

export async function GET() {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(WEATHER_LAT));
    url.searchParams.set("longitude", String(WEATHER_LON));
    url.searchParams.set("current", "temperature_2m,wind_speed_10m,weather_code");
    url.searchParams.set("hourly", "precipitation_probability");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url.toString(), { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(`open-meteo responded ${res.status}`);

    const data = (await res.json()) as OpenMeteoResponse;
    const current = data.current;
    if (!current || typeof current.temperature_2m !== "number" || typeof current.wind_speed_10m !== "number" || typeof current.weather_code !== "number") {
      throw new Error("malformed open-meteo payload");
    }

    let rainProb = 0;
    const hourlyTimes = data.hourly?.time ?? [];
    const hourlyProb = data.hourly?.precipitation_probability ?? [];
    const idx = current.time ? hourlyTimes.indexOf(current.time) : -1;
    if (idx >= 0 && typeof hourlyProb[idx] === "number") {
      rainProb = hourlyProb[idx];
    }

    const weather: Weather = {
      city: WEATHER_CITY,
      tempC: Math.round(current.temperature_2m),
      rainProb: Math.round(rainProb),
      windKph: Math.round(current.wind_speed_10m),
      condition: WEATHER_CODE_MAP[current.weather_code] ?? "Unknown",
      isMock: false,
    };

    return NextResponse.json(weather, { status: 200 });
  } catch (err) {
    console.error("[api/weather] fetch failed — returning mock reading:", err);
    return NextResponse.json(mockWeather(), { status: 200 });
  }
}
