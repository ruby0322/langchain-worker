export interface LineEvent {
	type: string;
	message?: {
		type: string;
		text: string;
	};
	replyToken?: string;
	source?: {
		type: 'user' | 'group' | 'room';
		userId?: string;
		groupId?: string;
		roomId?: string;
	};
}

export interface LineWebhookRequest {
	events: LineEvent[];
}

export interface LineMessage {
	type: string;
	text: string;
} 