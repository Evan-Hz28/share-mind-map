import type { NextFunction, Request, Response } from "express";
import { v7 as uuidv7 } from "uuid";

export const requestIdHeader = "x-request-id";
const validRequestId = /^[A-Za-z0-9._:-]{16,64}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header(requestIdHeader);
  const requestId = supplied !== undefined && validRequestId.test(supplied) ? supplied : uuidv7();
  (request as RequestWithId).requestId = requestId;
  response.setHeader(requestIdHeader, requestId);
  next();
}

export function getRequestId(request: Request): string {
  return (request as Partial<RequestWithId>).requestId ?? uuidv7();
}
