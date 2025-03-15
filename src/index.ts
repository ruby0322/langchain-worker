/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { awaitAllCallbacks } from 'langchain/callbacks';
import { LineHandler } from './line/handler';
import { LineEvent, LineWebhookRequest } from './line/types';

export interface Env {
	CHANNEL_ACCESS_TOKEN: string;
	CHANNEL_SECRET: string;
	GOOGLE_API_KEY: string;
	OPENAI_API_KEY: string;
	CHAT_HISTORY: KVNamespace;
	DB: D1Database;
	LANGSMITH_API_KEY: string;
	LANGSMITH_PROJECT: string;
}

export default {
	fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;
		console.log('Received request:', request);

		// Handle GET request for connection test
		if (method === 'GET' && path === '/') {
			return new Response(JSON.stringify({
				status: 'success',
				message: 'Connected successfully!',
			}), {
				headers: {
					'Content-Type': 'application/json',
				},
			});
		}

		// Handle LINE webhook
		if (method === 'POST' && path === '/callback') {
			try {
				const body = await request.json() as LineWebhookRequest;

				// Log the received body for debugging
				console.log('Received body:', body);

				// Create the response object immediately
				const response = new Response(JSON.stringify({ status: 'success' }), {
					headers: { 'Content-Type': 'application/json' },
				});

				// Send the response immediately
				ctx.waitUntil(
					// Make an HTTP request to the /reply route to process events
					(async () => {
						const events = body.events as LineEvent[];
						const handler = new LineHandler(
							env.CHANNEL_ACCESS_TOKEN,
							env.OPENAI_API_KEY,
							env.CHAT_HISTORY,
							env.DB,
							env.LANGSMITH_API_KEY,
							env.LANGSMITH_PROJECT
						);

						// Process the events using Promise.all
						const processingPromises = events.map(async (event: LineEvent) => {
							console.log('Processing event:', event); // Log each event
							try {
								return await handler.handleMessage(event);
							} catch (error) {
								console.error('Error processing event:', error); // Log any errors
							}
						});

						// Wait for all processing to complete
						await Promise.all(processingPromises);
					})()
				);

				// Return the immediate response
				return response; 
			} catch (error) {
				console.error('Error handling request:', error);
				return new Response(
					JSON.stringify({
						status: 'error',
						message: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			} finally {
				await awaitAllCallbacks();
			}
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
