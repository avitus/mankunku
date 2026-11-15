import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('defaults to Musicality and honors the explicit saved Original fallback', async () => {
 const getItem=vi.fn().mockReturnValue(null),setItem=vi.fn();vi.stubGlobal('localStorage',{getItem,setItem});
 const pref=await import('$lib/audio/backing-preference');
 expect(pref.getBackingArrangementPreference()).toBe('coordinated');
 getItem.mockReturnValue('original');expect(pref.getBackingArrangementPreference()).toBe('original');
 getItem.mockReturnValue('corrupt');expect(pref.getBackingArrangementPreference()).toBe('coordinated');
 pref.setBackingArrangementPreference('original');expect(setItem).toHaveBeenCalledWith('backing-arrangement-v1','original');
 expect(pref.getBackingArrangementPreference()).toBe('original');
});
it('keeps rollback usable for this session when browser storage is blocked', async () => {
 vi.stubGlobal('localStorage',{getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}});
 const pref=await import('$lib/audio/backing-preference');
 expect(pref.getBackingArrangementPreference()).toBe('coordinated');
 pref.setBackingArrangementPreference('original');expect(pref.getBackingArrangementPreference()).toBe('original');
});
