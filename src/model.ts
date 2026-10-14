import type { AssistantMessage, Message, Model, ModelReply, ToolCall, ToolDefinition } from "./types.js";

const endpoint = "https://api.deepseek.com/chat/completions";
const modelName = "deepseek-flash";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinishReason(value: unknown): value is ModelReply["finishReason"] {
  return value === "stop" || value === "tool_calls" || value === "length" ||
    value === "content_filter" || value === "insufficient_system_resource" || value === "aborted";
}

function parseToolCall(value: unknown): ToolCall {
  if (!isRecord(value) || value.type !== "function" ||
      typeof value.id !== "string" || !value.id || !isRecord(value.function) ||
      typeof value.function.name !== "string" || !value.function.name ||
      typeof value.function.arguments !== "string") {
    throw new Error("DeepSeek 返回了不合法的工具调用结构");
  }
  return {
    id: value.id, type: "function",
    function: { name: value.function.name, arguments: value.function.arguments },
  };
}

export class DeepSeekModel implements Model {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error("请先在 .env 中填写 DEEPSEEK_API_KEY");
  }

  async complete(messages: Message[], tools: ToolDefinition[]): Promise<ModelReply> {
    // One request, no streaming or custom retries. Native fetch needs no runtime SDK.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: modelName,
        messages,
        tools: tools.map(tool => ({ type: "function", function: {
          name: tool.name, description: tool.description, parameters: tool.parameters,
        } })),
        stream: false,
        thinking: { type: "disabled" },
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const hint = response.status === 401 ? "；请检查 API Key" :
        response.status === 402 ? "；请检查账户余额" : "";
      throw new Error(`DeepSeek 请求失败：HTTP ${response.status}${hint}`);
    }

    // Validate the external JSON at runtime instead of assuming its TS shape.
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.choices)) throw new Error("DeepSeek 响应缺少 choices");
    const choice: unknown = data.choices[0];
    if (!isRecord(choice) || !isFinishReason(choice.finish_reason) || !isRecord(choice.message)) {
      throw new Error("DeepSeek 响应缺少合法的消息或停止原因");
    }
    const raw = choice.message;
    if (raw.role !== "assistant" || (raw.content !== null && typeof raw.content !== "string")) {
      throw new Error("DeepSeek assistant 消息格式不合法");
    }
    const message: AssistantMessage = { role: "assistant", content: raw.content };
    if (raw.tool_calls !== undefined && raw.tool_calls !== null) {
      if (!Array.isArray(raw.tool_calls)) throw new Error("DeepSeek tool_calls 必须是数组");
      message.tool_calls = raw.tool_calls.map(parseToolCall);
    }
    // Preserve protocol data if the provider returns it, even though thinking is disabled.
    if (raw.reasoning_content !== undefined) {
      if (raw.reasoning_content !== null && typeof raw.reasoning_content !== "string") {
        throw new Error("DeepSeek reasoning_content 格式不合法");
      }
      message.reasoning_content = raw.reasoning_content;
    }
    return { message, finishReason: choice.finish_reason };
  }
}
