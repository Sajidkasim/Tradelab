import React from 'react';
import {Button} from './components';

export const affirmations = [
  'I do not chase price. I wait for my setup and execute my plan with fixed risk.',
  'If my entry is gone, I wait for the next setup.',
  'The next trade has to meet my rules. It does not owe me back the last loss.',
  'I choose my risk before I enter, and I keep it fixed.',
  'A quiet session is still a good session when I follow my plan.',
  'I can let a winning move go by without making it my trade.',
  'I look at the chart in front of me. Yesterday’s result belongs in yesterday’s review.',
  'Before I click, I can say what makes this setup valid.',
  'When I feel rushed, I give myself a moment to check what I can actually see.',
  'My stopping rule still applies when I’m one trade away from a target.',
  'I can be confident in my preparation and uncertain about the outcome.',
  'I judge the decision by what I knew when I made it.',
  'After a win, I start the next decision from the same checklist.',
  'One well-reviewed trade teaches me more than a dozen rushed entries.',
  'I can admit I misread the setup and move on.',
  'I’m grateful for the chance to practise, whatever today’s result is.',
  'I leave enough space between decisions to notice what has changed.',
  'At the end of the session, I’ll write down one thing I want to repeat.',
];

export default function AffirmationPicker({value,onChange}) {
  const index = Math.max(0, affirmations.indexOf(value));
  const move = direction => onChange(affirmations[(index + direction + affirmations.length) % affirmations.length]);
  return <div className="mw-affirmation-picker">
    <blockquote aria-live="polite">{affirmations[index]}</blockquote>
    <div className="mw-affirmation-nav">
      <Button type="button" onClick={()=>move(-1)}>Previous affirmation</Button>
      <span>{index+1} / {affirmations.length}</span>
      <Button type="button" onClick={()=>move(1)}>Next affirmation</Button>
    </div>
  </div>;
}
