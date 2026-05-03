/**
 * P2 simulator for E2E multiplayer testing.
 * Run with: node tests/e2e-p2-sim.mjs <ROOM_CODE>
 *
 * This script:
 * 1. Creates a fresh anonymous Supabase user (P2/Hider)
 * 2. Joins the specified game as TestHider
 * 3. Polls until the game starts
 * 4. Answers the first pending question with "yes"
 * 5. Polls until game ends
 * 6. Reports all steps with timestamps
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://twjuqqzesavikwtlupzp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EmMNBJgjYCFa4jC_xDp7eQ_auU8-3yI';
const ROOM_CODE = process.argv[2]?.toUpperCase();

if (!ROOM_CODE) {
  console.error('Usage: node tests/e2e-p2-sim.mjs <ROOM_CODE>');
  process.exit(1);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Create Supabase client with in-memory auth (no localStorage)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
  }
});

async function main() {
  // Step 1: Authenticate as new anonymous user
  log('Creating anonymous user for P2...');
  const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
  if (authError) throw new Error('Auth failed: ' + authError.message);
  const p2UserId = authData.user?.id;
  log(`P2 user ID: ${p2UserId}`);

  // Step 2: Join game as TestHider
  log(`Joining game ${ROOM_CODE} as TestHider (hider)...`);
  const { data: joinData, error: joinError } = await supabase.rpc('join_game', {
    p_room_code: ROOM_CODE,
    p_display_name: 'TestHider',
    p_role: 'hider',
  });
  if (joinError) throw new Error('join_game failed: ' + joinError.message);
  log('Join result: ' + JSON.stringify(joinData));

  const gameId = joinData.game_id;
  const playerId = joinData.player_id;
  log(`Game ID: ${gameId}, Player ID: ${playerId}`);

  // Step 3: Poll for game phase to change to "playing"
  log('Waiting for host to start game...');
  let phase = 'setup';
  let pollCount = 0;
  while (phase === 'setup' && pollCount < 120) {
    await sleep(1000);
    const { data: game } = await supabase
      .from('games')
      .select('phase')
      .eq('id', gameId)
      .single();
    if (game) phase = game.phase;
    pollCount++;
    if (pollCount % 5 === 0) log(`  Still waiting... phase=${phase} (${pollCount}s)`);
  }
  if (phase !== 'playing') {
    throw new Error(`Game never started. Final phase: ${phase}`);
  }
  log(`✅ Game started! Phase is now: ${phase}`);

  // Step 4: Wait for a question to be sent (check questions table)
  log('Waiting for a question to be sent...');
  let question = null;
  pollCount = 0;
  while (!question && pollCount < 120) {
    await sleep(1000);
    const { data: questions } = await supabase
      .from('questions')
      .select('id, question_type, question_data')
      .eq('game_id', gameId)
      .order('question_order')
      .limit(1);
    if (questions && questions.length > 0) {
      question = questions[0];
    }
    pollCount++;
    if (pollCount % 5 === 0) log(`  Waiting for question... (${pollCount}s)`);
  }
  if (!question) {
    log('No question received in 120s — skipping answer step');
  } else {
    log(`✅ Question received: id=${question.id}, type=${question.question_type}`);
    log('Question data: ' + JSON.stringify(question.question_data).substring(0, 100));

    // Step 5: Answer the question with "yes" (simple answer)
    log('Answering question with yes...');
    const { data: answerData, error: answerError } = await supabase
      .from('answers')
      .insert({
        question_id: question.id,
        game_id: gameId,
        answered_by: playerId,
        answer_data: { answer: true },
      })
      .select('id')
      .single();
    if (answerError) {
      log('Answer insert failed: ' + answerError.message);
    } else {
      log(`✅ Answer recorded: id=${answerData?.id}`);
    }
  }

  // Step 6: Poll for game to end
  log('Waiting for game to end...');
  phase = 'playing';
  pollCount = 0;
  while (phase === 'playing' && pollCount < 180) {
    await sleep(1000);
    const { data: game } = await supabase
      .from('games')
      .select('phase')
      .eq('id', gameId)
      .single();
    if (game) phase = game.phase;
    pollCount++;
    if (pollCount % 10 === 0) log(`  Still playing... (${pollCount}s)`);
  }

  if (phase === 'ended') {
    log(`✅ GAME ENDED successfully after ${pollCount}s`);
  } else {
    log(`⚠️  Game did not end in time. Final phase: ${phase}`);
  }

  log('\n=== P2 simulation complete ===');
  log(`P2 user: ${p2UserId}`);
  log(`Game: ${ROOM_CODE} (${gameId})`);
  log(`Final phase: ${phase}`);
}

main().catch(err => {
  console.error('P2 simulation failed:', err.message);
  process.exit(1);
});
