import React from 'react';
import {WorkspacePage,useIdentity} from './WorkspacePages';
import ResourceLibrary from './ResourceLibrary';
export default function LearnPage(){const {identity}=useIdentity();return <WorkspacePage active="learn" kicker="THE PRIMUS LIBRARY" title="Learn" intro="Take an idea from understanding to practice. Videos, articles and guides from the Primus team, in one place."><ResourceLibrary section="learn" identity={identity}/><section className="wp-panel wp-links"><h2>Bring the lesson to your own process.</h2><a href="/backtesting">Practise in Backtesting ↗</a><a href="/lab">Explore your results ↗</a><a href="/journal">Reflect in your Journal ↗</a></section></WorkspacePage>}
