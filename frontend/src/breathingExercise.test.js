import {it,expect} from 'vitest';
import {breathingPhase} from './BreathingExercise';
it('breathing cycle has four inhale seconds and six exhale seconds',()=>{
 expect(breathingPhase(0)).toEqual({label:'Breathe in gently',remaining:4,inhale:true});
 expect(breathingPhase(3).remaining).toBe(1);expect(breathingPhase(4)).toEqual({label:'Breathe out gently',remaining:6,inhale:false});
 expect(breathingPhase(9).remaining).toBe(1);expect(breathingPhase(10)).toEqual(breathingPhase(0));
});
