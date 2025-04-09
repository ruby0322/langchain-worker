import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { z } from "zod";
import { LineClient } from './client';
import { AIConfig, ducklingConfig, getDefaultReplyMessage, QUICK_REPLY_ITEM } from './config';
import { ChatMessage, ChatStorage } from './storage';
import { Document, LineEvent } from './types';

import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { Client } from "langsmith";

const DocumentSchema = z.object({
	title: z.string().describe("The title of the document"),
	description: z.string().describe("Brief description of the document"),
	content: z.string().optional().describe("Text content of the document"),
	labels: z.array(z.string().describe("Tag for the document")).describe("Tags for the document"),
});

interface MessageAdditionalKwargs {
	timestamp: string;
	[key: string]: unknown;
}

interface AgentInput {
	input: string;
	chat_history?: string;
}

export class LineHandler {
	private client: LineClient;
	private agent: AgentExecutor | null = null;
	private config: AIConfig;
	private storage: ChatStorage;
	private chatModel: ChatOpenAI;
	// private eventService: EventService;
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

		const client = new Client({
			apiKey: langsmithApiKey,
			apiUrl: "https://api.smith.langchain.com",
		});

		this.tracer = new LangChainTracer({ client, projectName: langsmithProject });

		this.tools = [
			new DynamicStructuredTool({
				name: "create_document",
				description: "新增文件用的工具",
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
					return `新增成功："${JSON.stringify({ title: result.document.title, labels: result.document.labels })}"`;
				  } catch (error) {
					return `新增失敗：${error instanceof Error ? error.message : '未知錯誤'}`;
				  }
				},
			}),
		];
	}

	private async initializeAgent(userId: string) {
		
		const systemPrompt = `${this.config.systemPrompt}`;

		const prompt = ChatPromptTemplate.fromMessages([
			["system", systemPrompt],
			// ["system", "Previous conversation history:\n{chat_history}"],
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

		const filteredHistory = startIndex === -1 ? history : history.slice(startIndex+1);
		const messages = this.convertToLangChainMessages(filteredHistory);

		const input: AgentInput = {
			input: messages.map(msg => msg.content).join("\n"),
			// chat_history: chatHistory,
		};

		const result = await this.agent!.invoke(input, { callbacks: [this.tracer] });
		let response = result.output as string;

		return response;
	}

	async handleMessage(event: LineEvent) {
		if (event.source && event.source.type === 'user') {
			await this.client.startLoading(event.source.userId as string, 10);
		} else if (event.source && event.source.type === 'group') {
			await this.client.startLoading(event.source.groupId as string, 10);
		}
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
			const response = userMessage === '新增文件' ? (await this.handleChatMessage(history, userId)) : getDefaultReplyMessage(userMessage);

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
		}
	}
}