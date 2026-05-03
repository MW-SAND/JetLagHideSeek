/**
 * Multiplayer question + answer store.
 *
 * Committed questions live in Supabase `questions` table.
 * Each question can have an answer in the `answers` table.
 * Seekers draft locally, then commit. Hiders answer committed questions.
 *
 * Realtime subscriptions keep all clients in sync.
 */
import { atom, computed } from "nanostores";

import type { Question } from "@/maps/schema";
import { hiderifyQuestion } from "@/maps";

import { supabase } from "./supabase";
import { questions as localQuestions } from "./context";
import { gameSession, currentPlayer } from "./multiplayer";

// ─── Types ───────────────────────────────────────────────────

export interface CommittedQuestion {
    /** Supabase row id */
    dbId: string;
    /** question_order from DB (serial) */
    order: number;
    /** player id who asked */
    askedBy: string;
    /** The question type (radius, thermometer, etc.) */
    questionType: string;
    /** Full question data blob — same shape as the local Question["data"] */
    questionData: Record<string, unknown>;
    /** If answered, the answer data */
    answer: CommittedAnswer | null;
    createdAt: string;
}

export interface CommittedAnswer {
    dbId: string;
    answeredBy: string;
    answerData: Record<string, unknown>;
    answeredAt: string;
    undoDeadline: string;
}

export interface DraftAnswerSelection {
    confirmed: boolean;
    selectedTentacleName?: string;
    selectedTentacleLocation?: any;
}

// ─── Stores ──────────────────────────────────────────────────

/** All committed questions for the current game (sorted by order) */
export const committedQuestions = atom<CommittedQuestion[]>([]);

/** Local draft questions being built by the current seeker (not yet sent) */
export const draftQuestions = atom<Question[]>([]);

/** Hider-only local answer selections before submitting to the DB */
export const answerDraftSelections = atom<Record<string, DraftAnswerSelection>>({});

/** Derived: questions that have been answered (for map rendering) */
export const answeredQuestions = computed(committedQuestions, (qs) =>
    qs.filter((q) => q.answer !== null),
);

/** Derived: questions awaiting an answer from hiders */
export const unansweredQuestions = computed(committedQuestions, (qs) =>
    qs.filter((q) => q.answer === null),
);

export function applyAnswerToQuestionData(
    questionType: string,
    questionData: Record<string, unknown>,
    answerData: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...questionData } as any;
    const confirmed = !!answerData.confirmed;

    if (
        questionType === "tentacles" &&
        Object.prototype.hasOwnProperty.call(answerData, "selectedTentacleLocation")
    ) {
        next.location = (answerData as any).selectedTentacleLocation;
        return next;
    }

    if (confirmed) return next;

    switch (questionType) {
        case "radius":
            next.within = !next.within;
            break;
        case "thermometer":
            next.warmer = !next.warmer;
            break;
        case "measuring":
            next.hiderCloser = !next.hiderCloser;
            break;
        case "matching":
            next.same = !next.same;
            break;
        case "tentacles":
            next.location = false;
            break;
    }

    return next;
}

function tentacleLocationKey(value: any): string {
    if (!value || value === false) return "false";
    const name = value?.properties?.name;
    const coords = value?.geometry?.coordinates;
    return `${String(name ?? "")}:${JSON.stringify(coords ?? [])}`;
}

export function deriveTentacleConfirmed(
    originalLocation: any,
    selectedLocation: any,
): boolean {
    return tentacleLocationKey(originalLocation) === tentacleLocationKey(selectedLocation);
}

export async function deriveSuggestedConfirmed(question: CommittedQuestion): Promise<boolean> {
    const original = { ...(question.questionData as Record<string, unknown>) } as any;
    const simulated = await hiderifyQuestion({
        id: question.questionType as any,
        key: -1,
        data: {
            ...original,
            drag: true,
            collapsed: true,
        },
    } as any);
    const resolved = simulated.data as any;

    switch (question.questionType) {
        case "radius":
            return resolved.within === original.within;
        case "thermometer":
            return resolved.warmer === original.warmer;
        case "measuring":
            return resolved.hiderCloser === original.hiderCloser;
        case "matching":
            return resolved.same === original.same;
        case "tentacles":
            return tentacleLocationKey(resolved.location) === tentacleLocationKey(original.location);
        default:
            return true;
    }
}

export async function deriveSuggestedTentacleSelection(question: CommittedQuestion): Promise<{
    selectedTentacleName: string;
    selectedTentacleLocation: any;
    confirmed: boolean;
}> {
    const original = { ...(question.questionData as Record<string, unknown>) } as any;
    const simulated = await hiderifyQuestion({
        id: question.questionType as any,
        key: -1,
        data: {
            ...original,
            drag: true,
            collapsed: true,
        },
    } as any);

    const resolvedLocation = (simulated.data as any).location;
    return {
        selectedTentacleName:
            resolvedLocation === false
                ? "false"
                : String(resolvedLocation?.properties?.name ?? "false"),
        selectedTentacleLocation: resolvedLocation,
        confirmed: deriveTentacleConfirmed(original.location, resolvedLocation),
    };
}

export function setDraftAnswerSelection(
    question: CommittedQuestion,
    answerData: DraftAnswerSelection,
) {
    answerDraftSelections.set({
        ...answerDraftSelections.get(),
        [question.dbId]: answerData,
    });

    const resolvedData = applyAnswerToQuestionData(
        question.questionType,
        question.questionData,
        answerData,
    );

    localQuestions.set(
        localQuestions.get().map((q) =>
            (q.data as any)._dbId === question.dbId
                ? {
                      ...q,
                      data: {
                          ...resolvedData,
                          drag: false,
                          collapsed: true,
                          _dbId: question.dbId,
                      },
                  }
                : q,
        ),
    );
}

export function clearDraftAnswerSelection(questionDbId: string) {
    const next = { ...answerDraftSelections.get() };
    delete next[questionDbId];
    answerDraftSelections.set(next);
}

// ─── Fetch ───────────────────────────────────────────────────

export async function fetchCommittedQuestions(gameId: string) {
    const [questionsResult, answersResult] = await Promise.all([
        supabase
            .from("questions")
            .select("*")
            .eq("game_id", gameId)
            .order("question_order"),
        supabase.from("answers").select("*").eq("game_id", gameId),
    ]);

    const rawQuestions = questionsResult.data ?? [];
    const rawAnswers = answersResult.data ?? [];

    // Index answers by question_id
    const answersByQuestionId = new globalThis.Map<string, (typeof rawAnswers)[0]>();
    for (const a of rawAnswers) {
        answersByQuestionId.set(a.question_id, a);
    }

    const merged: CommittedQuestion[] = rawQuestions.map((q) => {
        const a = answersByQuestionId.get(q.id);
        return {
            dbId: q.id,
            order: q.question_order,
            askedBy: q.asked_by,
            questionType: q.question_type,
            questionData: q.question_data as Record<string, unknown>,
            createdAt: q.created_at,
            answer: a
                ? {
                      dbId: a.id,
                      answeredBy: a.answered_by,
                      answerData: a.answer_data as Record<string, unknown>,
                      answeredAt: a.answered_at,
                      undoDeadline: a.undo_deadline,
                  }
                : null,
        };
    });

    committedQuestions.set(merged);
}

// ─── Seeker actions ──────────────────────────────────────────

/**
 * Strip editing-state fields from question data before persisting.
 * Prevents leaking the `drag` flag (which signals an in-progress edit)
 * into the DB where all players — including the hider — can read it.
 */
function sanitizeForStorage(data: Record<string, unknown>): Record<string, unknown> {
    const { drag: _drag, ...rest } = data;
    return rest;
}

/** Commit a question from the seeker's local draft to the DB */
export async function commitQuestion(question: Question) {
    const session = gameSession.get();
    const player = currentPlayer.get();
    if (!session || !player) throw new Error("Not in a game");

    const { data: inserted, error } = await supabase
        .from("questions")
        .insert({
            game_id: session.gameId,
            asked_by: player.id,
            question_type: question.id,
            // Strip drag flag so editing state is never persisted
            question_data: sanitizeForStorage(question.data as unknown as Record<string, unknown>),
        })
        .select("id")
        .single();

    if (error) throw error;

    // Tag the local question with its DB id so the sidebar knows it's committed
    // and won't show the "Send to Hider" button again.
    localQuestions.set(
        localQuestions.get().map((q) =>
            q.key === question.key
                ? { ...q, data: { ...q.data, _dbId: inserted.id } }
                : q,
        ),
    );

    // Realtime will pick up the new question, but also eagerly refetch
    await fetchCommittedQuestions(session.gameId);
}

// ─── Hider actions ───────────────────────────────────────────

/** Submit an answer to a committed question */
export async function answerQuestion(
    questionDbId: string,
    answerData: Record<string, unknown>,
) {
    const session = gameSession.get();
    const player = currentPlayer.get();
    if (!session || !player) throw new Error("Not in a game");

    const { error } = await supabase.from("answers").insert({
        question_id: questionDbId,
        game_id: session.gameId,
        answered_by: player.id,
        answer_data: answerData,
    });

    if (error) throw error;
    clearDraftAnswerSelection(questionDbId);
    await fetchCommittedQuestions(session.gameId);
}

/** Undo an answer (only before undo_deadline) */
export async function undoAnswer(answerDbId: string) {
    const { error } = await supabase
        .from("answers")
        .delete()
        .eq("id", answerDbId);

    if (error) throw error;

    const session = gameSession.get();
    if (session) await fetchCommittedQuestions(session.gameId);
}

// ─── Realtime ────────────────────────────────────────────────

let qaChannel: ReturnType<typeof supabase.channel> | null = null;

export function subscribeToQuestions(gameId: string) {
    if (qaChannel) {
        supabase.removeChannel(qaChannel);
    }

    qaChannel = supabase
        .channel(`qa:${gameId}`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "questions",
                filter: `game_id=eq.${gameId}`,
            },
            () => {
                fetchCommittedQuestions(gameId);
            },
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "answers",
                filter: `game_id=eq.${gameId}`,
            },
            () => {
                fetchCommittedQuestions(gameId);
            },
        )
        .subscribe();
}

export function unsubscribeFromQuestions() {
    if (qaChannel) {
        supabase.removeChannel(qaChannel);
        qaChannel = null;
    }
}
