import {it,expect} from 'vitest';
import {ticketLabelOffset} from './replayTicketLayout';
it.each([['buy','target',-52],['buy','stop',52],['sell','target',52],['sell','stop',-52]])('%s %s labels sit on the correct side of entry', (side,kind,expected)=>{
 expect(ticketLabelOffset(kind,side,200,200)).toBe(expected);
 expect(ticketLabelOffset(kind,side,200,200+expected)).toBe(0);
 expect(ticketLabelOffset('entry',side,200,200)).toBe(0);
});
