import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { z } from "zod";
import { LineClient } from './client';
import { AIConfig, DEFAULT_REPLY_MESSAGE, ducklingConfig, QUICK_REPLY_ITEM } from './config';
import { EventService } from './services/event';
import { ChatMessage, ChatStorage } from './storage';
import { Document, LineEvent } from './types';

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
		config: AIConfig = ducklingConfig
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
				name: "create_document",
				description: "Create a new document with title, description, content, and labels",
				schema: z.object({
				  title: z.string().describe("The title of the document"),
				  description: z.string().describe("Brief description of the document"),
				  content: z.string().optional().describe("Text content of the document"),
				  labels: z.array(z.string().describe("Tag for the document")).describe("Tags for the document"),
				}),
				func: async ({ title, description, labels, content }): Promise<string> => {
				  try {
					const response = await fetch("https://dump-duck-web-client.pages.dev/api/documents/", {
					  method: "POST",
					  headers: {
						"Content-Type": "application/json",
					  },
					  body: JSON.stringify({
						title,
						description,
						content,
						documnet_type: 'text',
						creator_id: 1,
						labels
					  }),
					});
			  
					  const result = await response.json() as { document: Document };
					  console.log(result)
					return `成功新增文件："${JSON.stringify({ title: result.document.title, labels: result.document.labels })}"`;
				  } catch (error) {
					return `新增文件失敗：${error instanceof Error ? error.message : '未知錯誤'}`;
				  }
				},
			}),
			new DynamicStructuredTool({
				name: "get_current_time",
				description: "Get current time",
				schema: z.object({
				}),
				func: async ({ }): Promise<string> => {
					return new Date().toLocaleString('zh-TW', { hour12: false });
				},
			})
			// new DynamicStructuredTool({
			// 	name: "create_event",
			// 	description: "Create a new event with title and time",
			// 	schema: z.object({
			// 		title: z.string().describe("The title of the event"),
			// 		start_time: z.string().describe("Start time in ISO format (YYYY-MM-DDTHH:mm:ss)"),
			// 		end_time: z.string().optional().describe("Optional end time in ISO format"),
			// 		creator_id: z.string().describe("LINE user ID of the creator"),
			// 	}),
			// 	func: async ({ title, start_time, end_time, creator_id }): Promise<string> => {
			// 		const event = await this.eventService.createEvent({
			// 			title,
			// 			start_time,
			// 			end_time: end_time || null,
			// 			creator_id,
			// 		});
			// 		console.log('create_event', { title, start_time, end_time, creator_id });
			// 		return `新增了事件："${JSON.stringify(event)}"`;
			// 	},
			// }),
			// new DynamicStructuredTool({
			// 	name: "get_upcoming_events",
			// 	description: "Get upcoming events for a user",
			// 	schema: z.object({
			// 		creator_id: z.string().describe("LINE user ID to get events for"),
			// 	}),
			// 	func: async ({ creator_id }): Promise<string> => {
			// 		const events = await this.eventService.getUpcomingEvents(creator_id);
			// 		if (events.length === 0) {
			// 			return "No upcoming events found.";
			// 		}
			// 		return events
			// 			.map(event =>
			// 				`- ${event.title}: ${new Date(event.start_time).toLocaleString('zh-TW', { hour12: false })}` +
			// 				(event.end_time ? ` ~ ${new Date(event.end_time).toLocaleString('zh-TW', { hour12: false })}` : '')
			// 			)
			// 			.join('\n');
			// 	},
			// }),
		];
	}

	private async initializeAgent(userId: string) {
		
		// 更新系統提示以包含事件功能和用戶 ID
		const systemPrompt = `${this.config.systemPrompt}`;

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

		 // 尋找最後一次「新增文件」或「取消」的索引
		const lastCommandIndex = history.map(msg => msg.content).lastIndexOf('新增文件', history.length - 2);
		const lastCancelIndex = history.map(msg => msg.content).lastIndexOf('取消', history.length - 2);
		const startIndex = Math.max(lastCommandIndex, lastCancelIndex);

		// 轉換過濾後的歷史訊息為 LangChain 格式
		const filteredHistory = startIndex === -1 ? history : history.slice(startIndex);
		const messages = this.convertToLangChainMessages(filteredHistory);
		const lastMessage = history[history.length - 1].content;

		// 格式化過濾後的聊天歷史為字串
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
			const response = userMessage === '新增文件' || userMessage === '取消' ? (await this.handleChatMessage(history, userId)) : DEFAULT_REPLY_MESSAGE;

			const items = [];
			items.push(QUICK_REPLY_ITEM.MANAGE_DOCS);
			if (userMessage !== '取消' && userMessage !== '新增文件') {
				items.push(QUICK_REPLY_ITEM.NEW_DOC);
				items.push(QUICK_REPLY_ITEM.CANCEL);
			}

			await this.client.replyMessage(
				event.replyToken,
				[{
					type: 'text',
					text: response,
					quickReply: {
						items
					}
				}]
			);

			// 保存 AI 回覆
			// console.log('Saving AI response:', {
			// 	userId: userId,
			// 	content: response
			// });
			// await this.storage.saveMessage(userId, {
			// 	role: 'assistant',
			// 	content: response,
			// 	timestamp: new Date().toISOString()
			// });
		}
	}
}