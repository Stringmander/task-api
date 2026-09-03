import { STATUS_CODES } from 'node:http';
import type { FastifyReply } from 'fastify';

export function sendError(reply: FastifyReply, statusCode: number, message: string) {
  reply.code(statusCode).send({
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
  });
}
