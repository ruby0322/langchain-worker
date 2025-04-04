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

export type DocumentType = 'text' | 'image' | 'file';

export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
}

export interface Document {
  id: number;
  title: string;
  description: string | null;
  type: DocumentType;
  favorite: boolean;
  created_at: string;
  creator_id: number;
  updated_at: string;
  content?: string;
  storage_path?: string;
  filename?: string;
  file_type?: string;
  labels: Label[];
  creator: User;
}

export interface DocumentsResponse {
  documents: Document[];
}

export function isDocument(obj: unknown): obj is Document {
  if (!obj || typeof obj !== 'object') return false;
  
  const doc = obj as Record<string, unknown>;
  return (
    typeof doc.id === 'number' &&
    typeof doc.title === 'string' &&
    (doc.description === null || typeof doc.description === 'string') &&
    ['text', 'image', 'file'].includes(doc.type as string) &&
    typeof doc.favorite === 'boolean' &&
    typeof doc.created_at === 'string' &&
    typeof doc.updated_at === 'string'
  );
}
