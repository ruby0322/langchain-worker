export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export class ChatStorage {
    private readonly MAX_MESSAGES = 10;  // 增加常數定義

    constructor(private kv: KVNamespace) {}

    async saveMessage(userId: string, message: ChatMessage) {
        const key = `chat:${userId}`;
        const messages = await this.getMessages(userId);
        messages.push(message);
        
        // 保留最近的 50 條消息
        const recentMessages = messages.slice(-this.MAX_MESSAGES);
        await this.kv.put(key, JSON.stringify(recentMessages));
    }

    async getMessages(userId: string): Promise<ChatMessage[]> {
        const key = `chat:${userId}`;
        const data = await this.kv.get(key);
        return data ? JSON.parse(data) : [];
    }
} 