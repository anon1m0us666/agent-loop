# 最简 DeepSeek 天气 Agent Loop

一个 TypeScript 项目，只有 5 个源码文件，只调用 DeepSeek，只注册一个 `get_current_weather` 工具。模型使用 `deepseek-flash`，通过 Chat Completions 发起非流式请求并显式关闭思考模式。HTTP 请求使用 Node 原生 fetch，没有供应商 SDK、缓存或自定义重试。

## 文件职责

```text
agent loop/
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── .gitignore
├── .env.example
└── src/
    ├── index.ts       # 创建模型、注册工具、传入任务、打印答案
    ├── types.ts       # 消息、工具、模型返回值、模型接口
    ├── model.ts       # 请求一次 DeepSeek，并检查响应格式
    ├── tools.ts       # 当前天气：参数校验 → 城市定位 → 查询天气
    └── agent-loop.ts  # 消息历史 → 模型 → 工具 → 结果 → 继续或结束
```

模型和工具的具体实例由 index.ts 传入，循环不 import 具体模型或天气实现。学习顺序可以是 types.ts → index.ts → agent-loop.ts → model.ts → tools.ts。

## 下载和启动

需要 Node.js 22.19+。先安装项目使用的 pnpm：

```bash
npm install -g pnpm@11.19.0
git clone https://github.com/anon1m0us666/agent-loop.git
cd agent-loop
pnpm install --frozen-lockfile
```

也可以点击 GitHub 的 Code → Download ZIP，解压后在项目根目录打开终端并运行 pnpm install --frozen-lockfile。

复制 .env.example 为 .env，填写自己的 DeepSeek API Key。macOS/Linux：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

在本地编辑 .env：

```dotenv
DEEPSEEK_API_KEY=你自己的DeepSeek密钥
```

.env 被 Git 忽略，仓库只提供空密钥示例。填写后启动：

```bash
pnpm typecheck
pnpm start
pnpm start "查询香港当前天气，告诉我温度、风速和数据时间。"
```

start 会先编译再加载 .env 并运行 dist/index.js，默认任务查询香港。传入任务字符串可覆盖默认任务。

这是一次任务模式：答案输出后程序结束，终端重新显示命令提示符。模型要求补充地点时，把补充信息写进下一次启动的任务，例如：

```bash
pnpm start "查询中国上海直辖市当前天气。调用工具时 city 使用 Shanghai, Shanghai Municipality，countryCode 使用 CN。"
```

浏览 GitHub 链接可以阅读和下载代码；运行程序需要在自己的电脑安装上述环境，并配置自己的密钥。DeepSeek API 调用计入所用密钥的账户额度。

## 一次运行会发生什么

1. index.ts 创建 DeepSeekModel、注册天气工具、提供任务与系统提示。
2. agent-loop.ts 将 system 和 user 消息交给模型。
3. model.ts 将工具说明包装成 API 要求的 function 格式，调用 DeepSeek。
4. 模型返回 tool_calls 时，循环保存完整 assistant 消息。
5. tools.ts 校验参数并查询 Open-Meteo，返回带单位、时间和来源的 JSON 字符串。
6. 循环添加 role=tool 消息，tool_call_id 对应模型调用 ID，随后再次请求模型。
7. finishReason=stop 且答案非空时返回答案；错误、截断或达到 6 轮上限时明确退出。

工具按顺序执行，单轮最多 4 次。最后一轮若仍要求工具，直接报轮数上限，不执行没有后续轮可消费结果的工具。网络请求设有超时。API 调用会使用你的 DeepSeek 账户额度。

## 当前天气工具

输入示例：`{"city":"Hong Kong","countryCode":"HK"}`。countryCode 可选；城市可附地区，如 `Paris, France`。先查询地理编码，优先精确名称和城市记录（GeoNames PPL 类型），再取该经纬度的 current 数据。同名的岛屿、行政区域不会误触发城市歧义；多个同名城市仍返回候选并要求澄清。

返回温度、体感温度、湿度、降水、风速、天气代码、时间和时区，保留单位。当前天气是 Open-Meteo 提供的天气模型估计；降水对应返回的 intervalSeconds 统计间隔，并不是未来整天降水量。数据来源为 [Open-Meteo](https://open-meteo.com/)，地点数据基于 GeoNames。该公开端点用于个人学习和非商业使用，无需天气 API Key。

## 以后自己修改

- 改默认任务或系统提示：index.ts。
- 改共同数据契约：types.ts。
- 修改 DeepSeek 请求参数：model.ts。
- 修改工具说明、参数或天气返回字段：tools.ts。
- 修改轮数、结果回传或停止行为：agent-loop.ts。

第一版保留这个范围，不加入界面、消息队列、持久化、复杂事件或多 Agent。

## 官方依据

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls/)
- [Open-Meteo 天气接口](https://open-meteo.com/en/docs)
- [Open-Meteo 地理编码](https://open-meteo.com/en/docs/geocoding-api)

## 本次验证（2026-10-14）

- pnpm typecheck 和 pnpm build 通过。
- 15 项离线行为检查通过：完整请求与结果配对、多个调用、错误参数、未知工具、轮数上限、截断与服务错误、DeepSeek 请求格式、天气数据与单位、地点歧义及香港城市匹配。
- 真实 DeepSeek + Open-Meteo 样本通过：第 1 轮调用 get_current_weather，第 2 轮根据真实结果回答。
- 该样本返回香港 2026-10-14 14:00（Asia/Hong_Kong）的数据：晴朗、29 °C、体感 31.1 °C、风速 20.6 km/h；这是当次验证样本，后续运行会查询更新数据。

修正记录：香港定位 API 同时返回城市、岛屿与区域的同名记录。现在优先使用精确名称中的 PPL 城市记录，真正的多城市匹配仍要求澄清。
