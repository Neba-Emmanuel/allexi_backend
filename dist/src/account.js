import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { databaseClient } from "./client.js";
const deletionSchema = z
    .object({
    password: z.string().min(1).max(256),
    confirmation: z.literal("DELETE"),
})
    .strict();
export function accountRouter(config) {
    const router = Router();
    router.delete("/account", rateLimit({
        windowMs: 15 * 60000,
        limit: 5,
        standardHeaders: "draft-8",
        legacyHeaders: false,
    }), async (req, res) => {
        const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
        if (!token) {
            res
                .status(401)
                .json({ error: "Sign in before deleting your account." });
            return;
        }
        if (!config.url ||
            !config.key ||
            (!config.serviceKey && !config.adminFactory)) {
            res.status(503).json({
                error: "Account deletion is temporarily unavailable. Please try again later.",
            });
            return;
        }
        const parsed = deletionSchema.safeParse(req.body);
        if (!parsed.success) {
            res
                .status(400)
                .json({ error: "Enter your current password and confirm deletion." });
            return;
        }
        const client = config.clientFactory?.(token) ??
            databaseClient(config.url, config.key, token);
        const { data: { user }, error, } = await client.auth.getUser(token);
        if (error || !user?.email) {
            res
                .status(401)
                .json({ error: "Sign in again before deleting your account." });
            return;
        }
        // Reauthenticate on a fresh client, without altering the caller's session.
        const verification = config.clientFactory?.() ?? databaseClient(config.url, config.key);
        const verified = await verification.auth.signInWithPassword({
            email: user.email,
            password: parsed.data.password,
        });
        if (verified.error || verified.data.user?.id !== user.id) {
            res
                .status(401)
                .json({ error: "Your current password could not be verified." });
            return;
        }
        if (verified.data.session)
            await verification.auth.signOut({ scope: "local" });
        const admin = config.adminFactory?.() ??
            databaseClient(config.url, config.serviceKey);
        const deleted = await admin.auth.admin.deleteUser(user.id);
        if (deleted.error) {
            console.error("Account deletion failed", {
                status: deleted.error.status,
            });
            res.status(503).json({
                error: "Your account could not be deleted. Please try again.",
            });
            return;
        }
        res.status(204).end();
    });
    return router;
}
