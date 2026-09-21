import assert from 'node:assert';
import { evaluateChatCommand } from '../src/lib/commandRouter';
import { actionExecutionGateway } from '../src/lib/actionExecutionGateway';
import { resolveCapabilityInput } from '../src/lib/capabilitySystem';
import { ScreenId } from '../src/types';

console.log('=== RUNNING AXON INVOCATION BOUNDARY & AUTHORIZATION AUDIT TEST SUITE ===');

let navigatedScreen: ScreenId | null = null;
const mockActions = {
  navigateTo: (screen: ScreenId) => {
    navigatedScreen = screen;
  },
};

function reset() {
  navigatedScreen = null;
}

// ----------------------------------------------------------------------------
// 1. EXPLICITLY INVOKED COMMAND
// Must be tagged as 'explicit_command', given immediate execution policy,
// and execute directly without asking for confirmation.
// ----------------------------------------------------------------------------
{
  console.log('\n--- 1. Explicitly Invoked Commands ---');
  reset();

  // Test 1a: Slash command (/open settings)
  const res1a = evaluateChatCommand('/open settings', mockActions, 'axon');
  assert.strictEqual(res1a.handled, true, '1a: Should be handled');
  assert.strictEqual(res1a.executed, true, '1a: Should execute directly');
  assert.strictEqual(navigatedScreen, 'settings', '1a: Should navigate to settings');
  console.log('✓ 1a: "/open settings" executes directly without confirmation');

  // Test 1b: Natural command phrase ("open command settings")
  reset();
  const res1b = evaluateChatCommand('open command settings', mockActions, 'axon');
  assert.strictEqual(res1b.handled, true, '1b: Should be handled');
  assert.strictEqual(res1b.executed, true, '1b: Should execute directly');
  assert.strictEqual(navigatedScreen, 'settings', '1b: Should navigate to settings');
  console.log('✓ 1b: "open command settings" executes directly without confirmation');

  // Test 1c: Explicit run authorization ("run open settings")
  reset();
  const res1c = evaluateChatCommand('run open settings', mockActions, 'axon');
  assert.strictEqual(res1c.handled, true, '1c: Should be handled');
  assert.strictEqual(res1c.executed, true, '1c: Should execute directly');
  assert.strictEqual(navigatedScreen, 'settings', '1c: Should navigate to settings');
  console.log('✓ 1c: "run open settings" executes directly without confirmation');
}

// ----------------------------------------------------------------------------
// 2. ORDINARY NATURAL-LANGUAGE REQUEST
// Must be tagged as 'natural_language', given 'suggestion' execution policy,
// and MUST NOT execute directly — presents a suggestion button instead.
// ----------------------------------------------------------------------------
{
  console.log('\n--- 2. Ordinary Natural-Language Requests ---');
  reset();

  const res2 = evaluateChatCommand('open settings', mockActions, 'axon');
  assert.strictEqual(res2.handled, true, '2: Handled as capability suggestion');
  assert.strictEqual(res2.executed, false, '2: MUST NOT execute directly');
  assert.strictEqual(navigatedScreen, null, '2: Must not navigate before user action');
  assert.ok(res2.response.includes('Would you like to open **Settings**?'), '2: Asks for user confirmation');
  assert.ok(res2.actions && res2.actions.length > 0, '2: Provides contextual action button');
  console.log('✓ 2: "open settings" does not execute directly; presents suggestion button');
}

// ----------------------------------------------------------------------------
// 3. CONTEXTUAL ACTION / BUTTON ACTIVATION
// Must carry 'contextual_action' invocation source and confirmedBy: 'user_click'.
// Executes immediately without redundant confirmation loops.
// ----------------------------------------------------------------------------
{
  console.log('\n--- 3. Contextual Action / Button Activation ---');
  reset();

  const res3 = evaluateChatCommand(
    '/open settings',
    mockActions,
    'axon',
    {
      invocationSource: 'contextual_action',
      confirmedBy: 'user_click',
      isConfirmed: true,
    }
  );
  assert.strictEqual(res3.handled, true, '3: Handled');
  assert.strictEqual(res3.executed, true, '3: Executes immediately');
  assert.strictEqual(navigatedScreen, 'settings', '3: Navigates to settings');
  console.log('✓ 3: Button click with contextual_action executes cleanly without loops');
}

// ----------------------------------------------------------------------------
// 4. FOLLOW-UP / CORRECTION TO EXISTING INTERACTION
// If an interaction is pending and user issues a correction (e.g. "No, I meant Settings"),
// the system must recognize it as a follow-up/correction and execute accordingly.
// ----------------------------------------------------------------------------
{
  console.log('\n--- 4. Follow-up / Correction Messages ---');
  reset();

  // First generate a suggestion state
  evaluateChatCommand('open tools', mockActions, 'axon');
  assert.strictEqual(navigatedScreen, null);

  // User corrects: "No, I meant Settings."
  const res4 = evaluateChatCommand('No, I meant Settings.', mockActions, 'axon');
  assert.strictEqual(res4.handled, true, '4: Handled correction');
  assert.strictEqual(res4.executed, true, '4: Executed redirected target');
  assert.strictEqual(navigatedScreen, 'settings', '4: Navigated to corrected target');
  console.log('✓ 4: Follow-up correction "No, I meant Settings." executes corrected target');
}

// ----------------------------------------------------------------------------
// 5. ACTION REQUIRING ELEVATED / SECOND-LEVEL AUTHORIZATION
// Actions marked with authorizationLevel: 'elevated' or requiresCommandAuthorization: true
// MUST NOT execute directly, even if invoked via command, until explicitly confirmed.
// ----------------------------------------------------------------------------
{
  console.log('\n--- 5. Elevated / Second-Level Authorization ---');
  reset();

  // Dispatch an elevated action through the gateway WITHOUT confirmation
  const unconfirmedElevated = actionExecutionGateway.dispatch({
    capabilityId: 'workspace_navigation',
    intent: 'open',
    target: 'settings',
    authorizationLevel: 'elevated',
    source: 'explicit_command',
    context: {
      currentScreen: 'axon',
      navigateTo: mockActions.navigateTo,
    },
  });

  assert.strictEqual(unconfirmedElevated.executed, false, '5a: Elevated action must not execute unconfirmed');
  assert.strictEqual(unconfirmedElevated.status, 'requires_confirmation', '5a: Status must be requires_confirmation');
  assert.strictEqual(unconfirmedElevated.failureCategory, 'authorization_blocked', '5a: Blocked by authorization');
  assert.strictEqual(navigatedScreen, null, '5a: Must not navigate');
  assert.ok(unconfirmedElevated.actions && unconfirmedElevated.actions.length > 0, '5a: Provides authorization action');
  console.log('✓ 5a: Elevated action is blocked and requires confirmation when unconfirmed');

  // Dispatch the elevated action WITH user confirmation
  const confirmedElevated = actionExecutionGateway.dispatch({
    capabilityId: 'workspace_navigation',
    intent: 'open',
    target: 'settings',
    authorizationLevel: 'elevated',
    source: 'contextual_action',
    confirmationState: {
      isConfirmed: true,
      confirmedBy: 'user_click',
    },
    context: {
      currentScreen: 'axon',
      navigateTo: mockActions.navigateTo,
    },
  });

  assert.strictEqual(confirmedElevated.executed, true, '5b: Confirmed elevated action must execute');
  assert.strictEqual(confirmedElevated.status, 'completed', '5b: Status must be completed');
  assert.strictEqual(navigatedScreen, 'settings', '5b: Navigated to target after confirmation');
  console.log('✓ 5b: Confirmed elevated action executes successfully to completion');
}

console.log('\n====================================================');
console.log('ALL INVOCATION BOUNDARY & AUTHORIZATION TESTS PASSED');
console.log('====================================================');
process.exit(0);
