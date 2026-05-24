import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from './env.js';

export async function bearerAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    void reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (token !== env.ASSET_TRACKER_TOKEN) {
    void reply.code(401).send({ error: 'unauthorized' });
    return;
  }
}
