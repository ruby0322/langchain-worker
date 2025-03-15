export interface Event {
    id?: number;
    title: string;
    start_time: string;
    end_time?: string | null;
    creator_id: string;
    created_at?: string;
}

export class EventService {
    constructor(private db: D1Database) {}

    async createEvent(event: Omit<Event, 'id' | 'created_at'>): Promise<Event> {
        console.log('createEvent', event);
        const { title, start_time, end_time, creator_id } = event;
        
        const result = await this.db
            .prepare(
                `INSERT INTO events (title, start_time, end_time, creator_id)
                 VALUES (?, ?, ?, ?)
                 RETURNING *`
            )
            .bind(title, start_time, end_time, creator_id)
            .first<Event>();
            
        if (!result) {
            console.error('Failed to create event', result);
            throw new Error('Failed to create event');
        }
        
        return result;
    }

    async getUpcomingEvents(creator_id: string): Promise<Event[]> {
        return await this.db
            .prepare(
                `SELECT * FROM events 
                 WHERE creator_id = ? 
                 AND start_time > datetime('now')
                 ORDER BY start_time ASC
                 LIMIT 5`
            )
            .bind(creator_id)
            .all<Event>()
            .then(result => result.results);
    }
} 