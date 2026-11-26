import { Router, type Response, type RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseClient } from "./client.js";
import {
  chapterQuerySchema,
  chapterSaveSchema,
  contentSnapshotSchema,
  defaultEditionSchema,
  editionSchema,
  bundledContent,
  publishSchema,
  type EditorialChapter,
} from "../shared/src/content.js";
import { chapterVerses } from "../shared/src/scripture.js";

export type ContentApiConfig = {
  url?: string;
  key?: string;
  serviceKey?: string;
  adminFactory?: () => SupabaseClient;
  clientFactory?: (token?: string) => SupabaseClient;
};
export function contentRouter(config: ContentApiConfig) {
  const router = Router();
  const client = (token?: string) =>
    config.clientFactory?.(token) ??
    databaseClient(config.url!, config.key!, token);
  const failure = (
    res: Response,
    error: { code?: string; message?: string },
  ) => {
    if (error.code === "42501")
      res.status(403).json({ error: "Administrator access is required." });
    else if (error.code === "40001")
      res.status(409).json({
        error:
          "Another editor changed this content. Your unsaved text is preserved; reload before saving again.",
      });
    else if (["22023", "23514", "23503", "22P02"].includes(error.code ?? ""))
      res.status(400).json({
        error:
          error.code === "22023" ? error.message : "Invalid scripture content.",
      });
    else {
      console.error("Content database error", { code: error.code });
      res.status(503).json({
        error:
          "Content management is unavailable. Check the content migration and connection.",
      });
    }
  };
  const requireAdmin: RequestHandler = async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in with an administrator account." });
      return;
    }
    if (!config.url || !config.key) {
      res
        .status(503)
        .json({ error: "Content management is not connected yet." });
      return;
    }
    const db = client(token);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error || !user) {
      res
        .status(401)
        .json({ error: "Your session has expired. Sign in again." });
      return;
    }
    const access = await db.rpc("is_content_admin");
    if (access.error) {
      failure(res, access.error);
      return;
    }
    if (access.data !== true) {
      res
        .status(403)
        .json({ error: "This account does not have administrator access." });
      return;
    }
    res.locals.contentClient = db;
    next();
  };
  const db = (res: Response) => res.locals.contentClient as SupabaseClient;
  function withKjvSource(data: EditorialChapter): EditorialChapter {
    if (data.edition !== "kjv") return data;
    const original = chapterVerses(data.book, data.chapter);
    return {
      ...data,
      verses: data.verses.map((row) =>
        row.status === "pending"
          ? { ...row, text: original[row.verse - 1]?.text ?? "" }
          : row,
      ),
    };
  }

  router.get("/content", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    if (!config.url || !config.key) {
      res.json({ ...bundledContent, configured: false });
      return;
    }
    const { data, error } = await client().rpc("reader_scripture_snapshot");
    if (error) {
      failure(res, error);
      return;
    }
    const parsed = contentSnapshotSchema.safeParse(data);
    if (!parsed.success) {
      res.status(503).json({ error: "Published content could not be read." });
      return;
    }
    const etag = `"scripture-${parsed.data.revision}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ ...parsed.data, configured: true });
  });
  router.use("/admin", requireAdmin);
  router.get("/admin/access", (_req, res) => res.json({ admin: true }));
  router.get("/admin/content/overview", async (req, res) => {
    const parsed = editionSchema.safeParse(req.query.edition);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose KJV or Allexi." });
      return;
    }
    const { data, error } = await db(res).rpc("admin_scripture_overview", {
      p_edition: parsed.data,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(data);
  });
  router.get("/admin/content/chapter", async (req, res) => {
    const parsed = chapterQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Unknown chapter or edition." });
      return;
    }
    const { edition, book, chapter } = parsed.data;
    const { data, error } = await db(res).rpc("admin_scripture_chapter", {
      p_edition: edition,
      p_book: book,
      p_chapter: chapter,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(withKjvSource(data));
  });
  router.put("/admin/content/chapter", async (req, res) => {
    const parsed = chapterSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Check the verse text, coordinates and revisions.",
        issues: parsed.error.issues,
      });
      return;
    }
    const { edition, book, chapter, changes } = parsed.data;
    const { data, error } = await db(res).rpc("save_scripture_chapter", {
      p_edition: edition,
      p_book: book,
      p_chapter: chapter,
      changes,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(withKjvSource(data));
  });
  router.post("/admin/content/publish", async (req, res) => {
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Choose saved, updated verses to publish." });
      return;
    }
    const { edition, book, chapter, revisions } = parsed.data;
    const { data, error } = await db(res).rpc("publish_scripture_chapter", {
      p_edition: edition,
      p_book: book,
      p_chapter: chapter,
      revisions,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(withKjvSource(data));
  });
  router.put("/admin/content/default-edition", async (req, res) => {
    const parsed = defaultEditionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Choose an edition and its current settings revision.",
      });
      return;
    }
    const { data, error } = await db(res).rpc("set_scripture_default", {
      p_edition: parsed.data.edition,
      expected_revision: parsed.data.expectedRevision,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(data);
  });
  router.get("/admin/content/history", async (req, res) => {
    const parsed = chapterQuerySchema.safeParse(req.query);
    const verse =
      req.query.verse === undefined ? null : Number(req.query.verse);
    if (
      !parsed.success ||
      (verse !== null &&
        (!Number.isInteger(verse) ||
          verse < 1 ||
          verse > chapterVerses(parsed.data.book, parsed.data.chapter).length))
    ) {
      res.status(400).json({ error: "Unknown passage." });
      return;
    }
    const { edition, book, chapter } = parsed.data;
    const { data, error } = await db(res).rpc("admin_scripture_history", {
      p_edition: edition,
      p_book: book,
      p_chapter: chapter,
      p_verse: verse,
    });
    if (error) {
      failure(res, error);
      return;
    }
    res.json(data);
  });
  return router;
}
