// These contracts are shared by the model, tools and loop.

// A tool request produced by DeepSeek; arguments is still a JSON string.
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning_content?: string | null;
}

// Use a union so only a tool message requires tool_call_id.
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

// Only these fields are sent to the model; execute stays in this process.
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool extends ToolDefinition {
  // Each tool validates unknown arguments before accessing them.
  execute(args: unknown): Promise<string>;
}

export interface ModelReply {
  message: AssistantMessage;
  finishReason:
    | "stop"
    | "tool_calls"
    | "length"
    | "content_filter"
    | "insufficient_system_resource"
    | "aborted";
}

export interface Model {
  complete(messages: Message[], tools: ToolDefinition[]): Promise<ModelReply>;
}
