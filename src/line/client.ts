export class LineClient {
	private baseUrl = 'https://api.line.me/v2/bot';
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	async replyMessage(replyToken: string, messages: { type: string; text: string; quickReply: { items: { type: string; action: { [k: string]: string } }[] } }[]) {
		return fetch(`${this.baseUrl}/message/reply`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.token}`,
			},
			body: JSON.stringify({
				replyToken,
				messages,
			}),
		});
	}

	async getGroupChatHistory(groupId: string) {
		const response = await fetch(`${this.baseUrl}/group/${groupId}/messages`, {
			headers: {
				'Authorization': `Bearer ${this.token}`,
			},
		});
		return response.json();
	}

	async getUserChatHistory(userId: string) {
		const response = await fetch(`${this.baseUrl}/message/${userId}/content`, {
			headers: {
				'Authorization': `Bearer ${this.token}`,
			},
		});
		return response.json();
	}

	async getProfile(userId: string) {
		const response = await fetch(`${this.baseUrl}/profile/${userId}`, {
			headers: {
				'Authorization': `Bearer ${this.token}`,
			},
		});
		return response.json();
	}

	async startLoading(chatId: string, loadingSeconds: number) {
		return await fetch(`${this.baseUrl}/chat/loading/start`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.token}`,
			},
			body: JSON.stringify({
				chatId,
				loadingSeconds,
			}),
		});
	}
}