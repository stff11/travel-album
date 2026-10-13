import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/ensureSchema";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lists change rarely and are re-fetched often. `no-cache` lets the browser
// keep a copy but revalidate with the (weak) ETag Express adds to every JSON
// response, so unchanged data comes back as a tiny 304.
app.use("/api", (req, res, next) => {
  if (req.method === "GET") res.set("Cache-Control", "private, no-cache");
  next();
});

// Make sure the database has the columns/indexes this version expects.
app.use("/api", async (_req, _res, next) => {
  try {
    await ensureSchema();
  } catch (err) {
    logger.error({ err }, "Schema check failed");
  }
  next();
});

app.use("/api", router);

// JSON errors instead of Express's HTML error page (multer file-type errors etc.)
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  const message = err instanceof Error ? err.message : "Internal server error";
  const status = (err as { status?: number })?.status ?? 400;
  res.status(status).json({ error: message });
});

export default app;
