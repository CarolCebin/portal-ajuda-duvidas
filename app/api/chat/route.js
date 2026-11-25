import 'server-only';
import { makeChatHandler } from '../../../lib/server/chat-http.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = makeChatHandler();
export const GET = handle;
export const POST = handle;
