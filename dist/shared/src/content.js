import { z } from "zod";
import allexiGenesis from "../data/allexi-genesis-1.json" with { type: "json" };
import { allVerses, books, chapterVerses, verseCount } from "./scripture.js";
export const editionSchema = z.enum(["kjv", "allexi"]);
export const editionNames = {
    kjv: "King James Version",
    allexi: "Allexi Bible",
};
export const editionLabels = {
    kjv: "KJV",
    allexi: "ALLEXI",
};
export const editorialStatusSchema = z.enum(["pending", "draft", "updated"]);
export const coordinateSchema = z.object({
    book: z.number().int().min(0).max(65),
    chapter: z.number().int().positive().max(150),
    verse: z.number().int().positive().max(176),
});
export function validCoordinate(p) {
    return p.verse >= 1 && p.verse <= verseCount(p.book, p.chapter);
}
export const chapterQuerySchema = z
    .object({
    edition: editionSchema,
    book: z.coerce.number().int().min(0).max(65),
    chapter: z.coerce.number().int().positive(),
})
    .refine((p) => p.chapter <= books[p.book].chapters, "Unknown chapter");
export const draftChangeSchema = coordinateSchema
    .extend({
    text: z.string().trim().min(1).max(20000),
    status: z.enum(["draft", "updated"]),
    expectedRevision: z.number().int().nonnegative(),
})
    .strict()
    .refine(validCoordinate, "Unknown verse");
export const chapterSaveSchema = z
    .object({
    edition: editionSchema,
    book: z.number().int().min(0).max(65),
    chapter: z.number().int().positive(),
    changes: z.array(draftChangeSchema).min(1).max(176),
})
    .strict()
    .superRefine((value, ctx) => {
    const seen = new Set();
    for (const change of value.changes) {
        if (change.book !== value.book ||
            change.chapter !== value.chapter ||
            seen.has(change.verse))
            ctx.addIssue({
                code: "custom",
                message: "Changes must contain unique verses from the selected chapter",
            });
        seen.add(change.verse);
    }
});
export const publishSchema = z
    .object({
    edition: editionSchema,
    book: z.number().int().min(0).max(65),
    chapter: z.number().int().positive(),
    revisions: z
        .array(z
        .object({
        verse: z.number().int().positive(),
        revision: z.number().int().positive(),
    })
        .strict())
        .min(1)
        .max(176),
})
    .strict()
    .superRefine((value, ctx) => {
    const seen = new Set();
    for (const row of value.revisions) {
        if (!validCoordinate({ ...value, verse: row.verse }) ||
            seen.has(row.verse))
            ctx.addIssue({ code: "custom", message: "Invalid or duplicate verse" });
        seen.add(row.verse);
    }
});
export const defaultEditionSchema = z
    .object({
    edition: editionSchema,
    expectedRevision: z.number().int().nonnegative(),
})
    .strict();
const publishedVerseSchema = coordinateSchema
    .extend({
    edition: editionSchema,
    text: z.string().min(1).max(20000),
    revision: z.number().int().positive(),
    published_at: z.string(),
})
    .strict()
    .refine(validCoordinate, "Unknown verse");
export const contentSnapshotSchema = z.object({
    defaultEdition: editionSchema,
    revision: z.number().int().nonnegative(),
    configured: z.boolean().optional(),
    verses: z.array(publishedVerseSchema).max(62204),
});
export const emptyContent = {
    defaultEdition: "kjv",
    revision: 0,
    verses: [],
};
// Approved text ships with the app; later server publications replace this snapshot.
export const bundledContent = {
    defaultEdition: "allexi",
    revision: 0,
    verses: allexiGenesis.map((verse) => ({
        ...verse,
        edition: "allexi",
        revision: 1,
        published_at: "2026-10-31T00:00:00.000Z",
    })),
};
export const verseKey = (p) => `${p.book}.${p.chapter}.${p.verse}`;
export function publishedBible(snapshot, edition) {
    const publications = snapshot.verses.filter((v) => v.edition === edition);
    const overrides = new Map(publications.map((v) => [verseKey(v), v]));
    const verses = edition === "kjv"
        ? allVerses.map((v) => overrides.get(verseKey(v)) ?? v)
        : publications;
    const index = new Map(verses.map((v) => [verseKey(v), v]));
    const chapters = new Map();
    for (const verse of verses) {
        const key = `${verse.book}.${verse.chapter}`;
        const rows = chapters.get(key) ?? [];
        rows.push(verse);
        chapters.set(key, rows);
    }
    for (const rows of chapters.values())
        rows.sort((a, b) => a.verse - b.verse);
    return {
        verses,
        chapter: (book, chapter) => chapters.get(`${book}.${chapter}`) ?? [],
        text: (p) => index.get(verseKey(p))?.text ?? "",
        get: (p) => index.get(verseKey(p)),
    };
}
export function previewOverview(edition) {
    return {
        edition,
        defaultEdition: bundledContent.defaultEdition,
        revision: 0,
        chapters: books.flatMap((book) => Array.from({ length: book.chapters }, (_, i) => ({
            book: book.id,
            chapter: i + 1,
            total: chapterVerses(book.id, i + 1).length,
            draft: 0,
            updated: edition === "allexi" && book.id === 0 && i === 0 ? 31 : 0,
            published: edition === "allexi" && book.id === 0 && i === 0 ? 31 : 0,
        }))),
    };
}
