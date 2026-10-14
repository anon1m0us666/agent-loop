import type { Tool } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`天气服务请求失败：HTTP ${response.status}`);
  return response.json();
}

const weatherDescriptions: Record<number, string> = {
  0: "晴朗", 1: "大部晴朗", 2: "局部多云", 3: "阴天",
  45: "雾", 48: "冻雾", 51: "小毛毛雨", 53: "中毛毛雨", 55: "强毛毛雨",
  56: "小冻毛毛雨", 57: "强冻毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  66: "小冻雨", 67: "强冻雨", 71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
  80: "小阵雨", 81: "中阵雨", 82: "强阵雨", 85: "小阵雪", 86: "强阵雪",
  95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹",
};

export const currentWeatherTool: Tool = {
  name: "get_current_weather",
  description: "查询指定城市的当前天气。city 优先用英文城市名称，可加州或国家限定，如 Paris, France；countryCode 可选，为两位国家或地区代码，如 HK、CN、US。只查询当前天气，不查询未来预报。",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", minLength: 2, maxLength: 120, description: "城市名称，可带州或国家限定" },
      countryCode: { type: "string", pattern: "^[A-Za-z]{2}$", description: "可选的两位国家或地区代码" },
    },
    required: ["city"],
    additionalProperties: false,
  },

  async execute(args) {
    // Model-generated parameters are untrusted; validate before making requests.
    if (!isRecord(args) || Object.keys(args).some(key => key !== "city" && key !== "countryCode") ||
        typeof args.city !== "string" || args.city.trim().length < 2 || args.city.trim().length > 120) {
      throw new Error("参数必须包含 2–120 字符的 city，且只允许 city 和 countryCode");
    }
    if (args.countryCode !== undefined && (typeof args.countryCode !== "string" || !/^[A-Za-z]{2}$/.test(args.countryCode))) {
      throw new Error("countryCode 必须是两位国家或地区代码，例如 HK、CN、US");
    }
    const city = args.city.trim();
    const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodingUrl.search = new URLSearchParams({ name: city, count: "5", language: "en", format: "json" }).toString();
    if (typeof args.countryCode === "string") geocodingUrl.searchParams.set("countryCode", args.countryCode.toUpperCase());
    const geocoding = await getJson(geocodingUrl);
    if (!isRecord(geocoding)) throw new Error("城市查询响应格式不合法");
    if (geocoding.results === undefined) throw new Error(`没有找到城市：${city}，请补充国家或地区`);
    if (!Array.isArray(geocoding.results) || geocoding.results.some(item => !isRecord(item))) {
      throw new Error("城市查询结果格式不合法");
    }
    const results = geocoding.results.filter(isRecord);
    if (results.length === 0) throw new Error(`没有找到城市：${city}`);

    // Prefer an exact city name; ask for clarification if multiple candidates remain.
    const exactName = city.split(",")[0]?.trim().toLowerCase();
    const exact = results.filter(item => typeof item.name === "string" && item.name.toLowerCase() === exactName);
    const namedCandidates = exact.length > 0 ? exact : results;
    // GeoNames can use the same name for a city, island and administrative region.
    // A city query prefers populated-place records (PPL*), without guessing among cities.
    const cityCandidates = namedCandidates.filter(item =>
      typeof item.feature_code === "string" && item.feature_code.startsWith("PPL"));
    const candidates = cityCandidates.length > 0 ? cityCandidates : namedCandidates;
    if (candidates.length > 1) {
      return JSON.stringify({
        status: "ambiguous_location",
        message: "存在多个匹配地点，请让用户补充国家或州后再查询。",
        candidates: candidates.map(item => ({ city: item.name, region: item.admin1, country: item.country, countryCode: item.country_code })),
      });
    }
    const location = candidates[0];
    if (!location || typeof location.name !== "string" ||
        typeof location.latitude !== "number" || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
        typeof location.longitude !== "number" || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
      throw new Error("城市查询缺少合法的地点或经纬度");
    }

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    const fields = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation", "weather_code", "wind_speed_10m"];
    weatherUrl.search = new URLSearchParams({
      latitude: String(location.latitude), longitude: String(location.longitude),
      current: fields.join(","), timezone: "auto",
      temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm",
    }).toString();
    const weather = await getJson(weatherUrl);
    if (!isRecord(weather) || !isRecord(weather.current) || !isRecord(weather.current_units) || typeof weather.timezone !== "string") {
      throw new Error("天气响应缺少 current、current_units 或 timezone");
    }
    const current = weather.current;
    const units = weather.current_units;
    if (typeof current.time !== "string" || typeof current.interval !== "number" || !Number.isFinite(current.interval) || current.interval <= 0) {
      throw new Error("天气响应缺少合法的数据时间或统计间隔");
    }
    for (const field of fields) {
      const value = current[field];
      if (typeof value !== "number" || !Number.isFinite(value) || typeof units[field] !== "string") {
        throw new Error(`天气数据缺失或格式不合法：${field}`);
      }
    }
    // A narrow assertion after the field validation above, only for indexing the WMO map.
    const code = current.weather_code as number;
    return JSON.stringify({
      status: "ok",
      location: { city: location.name, region: location.admin1, country: location.country, countryCode: location.country_code, latitude: location.latitude, longitude: location.longitude },
      time: current.time,
      timezone: weather.timezone,
      intervalSeconds: current.interval,
      current: {
        temperature: { value: current.temperature_2m, unit: units.temperature_2m },
        apparentTemperature: { value: current.apparent_temperature, unit: units.apparent_temperature },
        humidity: { value: current.relative_humidity_2m, unit: units.relative_humidity_2m },
        precipitation: { value: current.precipitation, unit: units.precipitation },
        windSpeed: { value: current.wind_speed_10m, unit: units.wind_speed_10m },
        weatherCode: code, condition: weatherDescriptions[code] ?? `未知天气代码 ${code}`,
      },
      source: { name: "Open-Meteo", url: "https://open-meteo.com/", note: "当前天气来自天气模型估计；降水对应 intervalSeconds 的统计间隔。" },
    });
  },
};
