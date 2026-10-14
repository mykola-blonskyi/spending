import { beforeEach, describe, expect, it } from 'vitest';
import {
  dismissApprovalHint,
  recordSignInAttempt,
  resetSignInAttempts,
  shouldShowApprovalHint,
} from './signin-attempts';

describe('approval hint', () => {
  beforeEach(() => sessionStorage.clear());

  it('appears after the second attempt that did not come back signed in', () => {
    recordSignInAttempt();
    expect(shouldShowApprovalHint()).toBe(false);
    recordSignInAttempt();
    expect(shouldShowApprovalHint()).toBe(true);
  });

  it('stays dismissed for the tab, and a successful sign-in starts over', () => {
    recordSignInAttempt();
    recordSignInAttempt();
    dismissApprovalHint();
    recordSignInAttempt();
    expect(shouldShowApprovalHint()).toBe(false);

    resetSignInAttempts();
    recordSignInAttempt();
    recordSignInAttempt();
    expect(shouldShowApprovalHint()).toBe(true);
  });

  it('ignores a corrupted counter', () => {
    sessionStorage.setItem('spending.signin.attempts', 'many');
    expect(shouldShowApprovalHint()).toBe(false);
  });
});
