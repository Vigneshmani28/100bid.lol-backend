import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { ApiError } from "../lib/errors";

/**
 * Validates { params, query, body } against a zod schema and replaces the
 * request's params/body with the parsed (typed, coerced) values.
 */
export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    if (!result.success) {
      const details = result.error.flatten();
      next(new ApiError("VALIDATION_ERROR", "Please check your input and try again.", details));
      return;
    }

    const parsed = result.data as { params?: unknown; body?: unknown };
    if (parsed.params) req.params = parsed.params as typeof req.params;
    if (parsed.body) req.body = parsed.body;
    next();
  };
}
