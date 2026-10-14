import { runAgent } from "./agent-loop.js";
import { DeepSeekModel } from "./model.js";
import { currentWeatherTool } from "./tools.js";

async function main(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY：请将 .env.example 复制为 .env，填写密钥后再运行。");

  // One model, one tool, one task. Change the default task here or pass it as an argument.
  const model = new DeepSeekModel(apiKey);
  const tools = [currentWeatherTool];
  const task = process.argv.slice(2).join(" ").trim() || "请查询香港当前天气，用中文告诉我天气状况、温度、体感温度、降水、风速和数据时间。";
  const systemPrompt = `你是一个天气助手。查询当前天气时必须调用 get_current_weather，不能凭记忆编造天气。
城市优先用英文名称，知道国家或地区时传 countryCode，例如香港用 Hong Kong 和 HK。
地点不明确时询问用户；工具返回 ambiguous_location 时请用户补充地区，不能自行猜选。
工具报错时可纠正参数；服务不可用时明确说明无法查询，不编造结果。
最终用用户的语言回答，注明实际查询地点、数据时间和时区、单位以及来源 Open-Meteo。
区分当前天气与未来预报；数据来自天气模型估计，降水表示工具返回的统计间隔内的量。`;

  console.log(`任务：${task}`);
  const answer = await runAgent(task, model, tools, systemPrompt);
  console.log(`\n最终答案：\n${answer}`);
}

main().catch(error => {
  console.error(`运行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
