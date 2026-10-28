import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../contract/actions.ts';
import { openDb } from '../db.ts';
import { readSettings, saveSettings, setting } from './settings.ts';

describe('settings', () => {
  it('serves the defaults, then what was saved', () => {
    const db = openDb(':memory:');
    expect(readSettings(db)).toEqual({
      'core.lots': true,
      'drafts.cap': 15,
      'cost.monthlyCap': 5,
      'agent.name': 'Agent',
      'agent.icon': 'sparkles',
      'agent.tone': 'neutre',
      'agent.persona': '',
    });
    saveSettings(db, { 'drafts.cap': 30, 'core.lots': false });
    expect(setting(db, 'drafts.cap')).toBe(30);
    expect(setting(db, 'core.lots')).toBe(false);
    expect(setting(db, 'cost.monthlyCap')).toBe(5);
  });

  it('refuses out-of-range, wrong-type and unknown keys, saving nothing', () => {
    const db = openDb(':memory:');
    for (const bad of [
      { 'drafts.cap': 0 },
      { 'drafts.cap': 101 },
      { 'drafts.cap': 1.5 },
      { 'cost.monthlyCap': -1 },
      { 'cost.monthlyCap': 51 },
      { 'core.lots': 'yes' },
      { nope: 1 },
    ])
      expect(() => saveSettings(db, bad)).toThrow(InvalidInputError);
    expect(() => saveSettings(db, { 'core.lots': false, 'drafts.cap': 0 })).toThrow(InvalidInputError);
    expect(setting(db, 'core.lots')).toBe(true);
  });

  it('refuses a bad agent voice, accepts the limits', () => {
    const db = openDb(':memory:');
    for (const bad of [
      { 'agent.name': '' },
      { 'agent.name': 'x'.repeat(41) },
      { 'agent.icon': 'rocket' },
      { 'agent.tone': 'grossier' },
      { 'agent.persona': 'x'.repeat(501) },
    ])
      expect(() => saveSettings(db, bad)).toThrow(InvalidInputError);
    saveSettings(db, { 'agent.name': 'x'.repeat(40), 'agent.persona': 'x'.repeat(500), 'agent.icon': 'gem' });
    expect(setting(db, 'agent.icon')).toBe('gem');
  });
});
