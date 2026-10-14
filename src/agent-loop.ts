import type { Message, Model, Tool } from "./types.js";

export async function runAgent(
  task: string,
  model: Model,
  tools: Tool[],
  systemPrompt: string,
  maxSteps = 6,
): Promise<string> {
  if (!task.trim()) throw new Error("任务不能为空");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps 必须是正整数");
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error("工具名称不能重复");
  // State belongs to this invocation; there is no global conversation history.
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];
  const definitions = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

  for (let step = 1; step <= maxSteps; step++) {
    console.log(`\n[第 ${step} 轮] 请求 DeepSeek`);
    const { message, finishReason } = await model.complete(messages, definitions);
    if (finishReason !== "stop" && finishReason !== "tool_calls") {
      throw new Error(`模型未正常完成：${finishReason}`);
    }
    const calls = message.tool_calls ?? [];
    if (finishReason === "stop") {
      if (calls.length > 0) throw new Error("模型返回 stop，但仍包含工具调用");
      if (!message.content?.trim()) throw new Error("模型没有返回非空答案");
      return message.content;
    }
    if (calls.length === 0) throw new Error("模型返回 tool_calls，但工具调用列表为空");
    if (calls.length > 4) throw new Error("单轮最多允许 4 次工具调用");
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("同一轮的工具调用 ID 不能重复");
    if (step === maxSteps) break; // No tools if no next round can consume their results.

    // Keep the entire assistant message, including its tool calls, before their results.
    messages.push(message);
    for (const call of calls) {
      console.log(`[工具请求] ${call.function.name} ${call.function.arguments}`);
      let result: string;
      try {
        const tool = tools.find(item => item.name === call.function.name);
        if (!tool) throw new Error(`未知工具：${call.function.name}`);
        const args: unknown = JSON.parse(call.function.arguments);
        result = await tool.execute(args);
      } catch (error) {
        result = JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "工具执行失败" });
      }
      console.log(`[工具结果] ${result}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    // The next request gets the accumulated messages, including every paired result.
  }
  throw new Error(`已达到 ${maxSteps} 轮上限，任务尚未完成`);
}
