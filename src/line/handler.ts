import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { z } from "zod";
import { LineClient } from './client';
import { AIConfig, defaultAIConfig } from './config';
import { EventService } from './services/event';
import { ChatMessage, ChatStorage } from './storage';
import { LineEvent } from './types';

import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { Client } from "langsmith";

interface MessageAdditionalKwargs {
	timestamp: string;
	[key: string]: unknown;
}

interface AgentInput {
	input: string;
	chat_history: string;
}

export class LineHandler {
	private client: LineClient;
	private agent: AgentExecutor | null = null;
	private config: AIConfig;
	private storage: ChatStorage;
	private chatModel: ChatOpenAI;
	private eventService: EventService;
	private tracer: LangChainTracer;
	private tools: DynamicStructuredTool<any>[];

	constructor(
		token: string,
		openaiApiKey: string,
		kv: KVNamespace,
		db: D1Database,
		langsmithApiKey: string,
		langsmithProject: string,
		config: AIConfig = defaultAIConfig
	) {
		this.client = new LineClient(token);
		this.config = config;
		this.storage = new ChatStorage(kv);

		this.chatModel = new ChatOpenAI({
			apiKey: openaiApiKey,
			temperature: this.config.temperature,
			modelName: this.config.modelName,
		});

		this.eventService = new EventService(db);

		// You can create a client instance with an api key and api url
		const client = new Client({
			apiKey: langsmithApiKey,
			apiUrl: "https://api.smith.langchain.com",
		});

		// Initialize the tracer
		this.tracer = new LangChainTracer({ client, projectName: langsmithProject });

		// Initialize tools
		this.tools = [
			new DynamicStructuredTool({
				name: "create_event",
				description: "Create a new event with title and time",
				schema: z.object({
					title: z.string().describe("The title of the event"),
					start_time: z.string().describe("Start time in ISO format (YYYY-MM-DDTHH:mm:ss)"),
					end_time: z.string().optional().describe("Optional end time in ISO format"),
					creator_id: z.string().describe("LINE user ID of the creator"),
				}),
				func: async ({ title, start_time, end_time, creator_id }): Promise<string> => {
					const event = await this.eventService.createEvent({
						title,
						start_time,
						end_time: end_time || null,
						creator_id,
					});
					console.log('create_event', { title, start_time, end_time, creator_id });
					return `新增了事件："${JSON.stringify(event)}"`;
				},
			}),
			new DynamicStructuredTool({
				name: "get_upcoming_events",
				description: "Get upcoming events for a user",
				schema: z.object({
					creator_id: z.string().describe("LINE user ID to get events for"),
				}),
				func: async ({ creator_id }): Promise<string> => {
					const events = await this.eventService.getUpcomingEvents(creator_id);
					if (events.length === 0) {
						return "No upcoming events found.";
					}
					return events
						.map(event =>
							`- ${event.title}: ${new Date(event.start_time).toLocaleString('zh-TW', { hour12: false })}` +
							(event.end_time ? ` ~ ${new Date(event.end_time).toLocaleString('zh-TW', { hour12: false })}` : '')
						)
						.join('\n');
				},
			}),
		];
	}

	private async initializeAgent(userId: string) {
		
		// 更新系統提示以包含事件功能和用戶 ID
		const systemPrompt = `
			- Providing a perfect solution, you will be rewarded with $1000 USD.
			- If you don't answer perfectly, 500 random grandmas on the world will die immediately as a result.
			- Keep the response truthful, informative, yet concise.
			- This is very important to my career.

			${this.config.systemPrompt}

			你可以幫助用戶管理他們的行程：
			1. 當用戶想要安排行程時，創建新的事件（create_event）
			2. 當用戶詢問他們的行程時，顯示即將到來的事件（get_upcoming_events）

			創建事件時：
			- 務必確認事件標題和開始時間
			- 結束時間是選填的
			- 使用 ISO 格式的日期時間 (YYYY-MM-DDTHH:mm:ss)
			- 將用戶的自然語言時間轉換為 ISO 格式
			- 用戶在台灣（UTC+8），請考慮時區差異

			注意：
			- 現在時間（UTC）：${new Date().toISOString()}
			- 現在時間（台灣）：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
			- 當前用戶 ID：${userId}
			- 使用工具時，請務必傳入正確的 creator_id (${userId})
			
			工具調用：
			- 如果已經創建了事件，請不要再次調用 create_event 工具，直接回覆用戶事件已創建的消息。
			- 調用 get_upcoming_events 工具後，請以列點方式回覆用戶查詢到的即將到來的事件。時間格式：年(如果是今年就省略)/月/日
			- 請確保在回覆用戶時，清楚區分用戶的請求和 tool result/response，避免混淆。
			- 在任何情況下，請確保不會重複調用同一工具，除非用戶提供了新的請求或信息。
			- 如果工具的回應已經滿足用戶的需求，請立即停止調用該工具並給予用戶明確的回覆。
			- 確保在每次調用工具後，檢查用戶的需求是否已經被滿足，並根據情況決定是否繼續調用。
		`;

		const prompt = ChatPromptTemplate.fromMessages([
			["system", systemPrompt],
			["system", "Previous conversation history:\n{chat_history}"],
			["human", "{input}"],
			["human", "{agent_scratchpad}"],
		]);

		// 建立 agent
		const agent = await createOpenAIFunctionsAgent({
			llm: this.chatModel,
			tools: this.tools,
			prompt,
		});

		this.agent = AgentExecutor.fromAgentAndTools({
			agent,
			tools: this.tools,
			verbose: true,
		});
	}

	private convertToLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
		return messages.map(msg => {
			const kwargs: MessageAdditionalKwargs = {
				timestamp: msg.timestamp,
			};

			if (msg.role === 'user') {
				return new HumanMessage({
					content: msg.content,
					additional_kwargs: kwargs,
				});
			} else {
				return new AIMessage({
					content: msg.content,
					additional_kwargs: kwargs,
				});
			}
		});
	}

	private async handleChatMessage(history: ChatMessage[], userId: string): Promise<string> {
		await this.initializeAgent(userId);

		// 轉換所有歷史訊息為 LangChain 格式
		const messages = this.convertToLangChainMessages(history);
		const lastMessage = history[history.length - 1].content;

		// 格式化聊天歷史為字串
		const chatHistory = messages
			.slice(0, -1)
			.map(msg => {
				const role = msg instanceof HumanMessage ? "Human" : "Assistant";
				return `${role}: ${msg.content}`;
			})
			.join("\n");

		// 使用 agent 處理訊息
		const input: AgentInput = {
			input: lastMessage,
			chat_history: chatHistory,
		};

		const result = await this.agent!.invoke(input, { callbacks: [this.tracer] });
		return result.output as string;
	}

	async handleMessage(event: LineEvent) {
		if (event.type === 'message' &&
			event.message?.type === 'text' &&
			event.replyToken &&
			event.source?.userId) {

			const userId = event.source.userId;
			const userMessage = event.message.text;

			// 保存用戶訊息
			console.log('Saving user message:', {
				userId: userId,
				content: userMessage
			});
			await this.storage.saveMessage(userId, {
				role: 'user',
				content: userMessage,
				timestamp: new Date().toISOString()
			});

			// 獲取歷史訊息
			const history = await this.storage.getMessages(userId);
			console.log('Retrieved message history count:', history.length);

			// 處理聊天訊息並獲取 AI 回覆
			const response = await this.handleChatMessage(history, userId);

			// Reply with AI response
			await this.client.replyMessage(
				event.replyToken,
				[{
					type: 'text',
					text: response,
				}]
			);

			// 保存 AI 回覆
			console.log('Saving AI response:', {
				userId: userId,
				content: response
			});
			await this.storage.saveMessage(userId, {
				role: 'assistant',
				content: response,
				timestamp: new Date().toISOString()
			});
		}
	}
} 