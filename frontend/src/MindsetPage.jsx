import React from 'react';
import {WorkspacePage,useIdentity,SignInPanel} from './WorkspacePages';
import BreathingExercise from './BreathingExercise';
import MindsetSituations from './MindsetSituations';
import BrainExplorer from './BrainExplorer';
import ResourceLibrary from './ResourceLibrary';
import VisionBoard from './VisionBoard';
import {Notice,Button} from './components';
export default function MindsetPage(){const {identity,error,reload}=useIdentity();return <WorkspacePage active="mindset" kicker="PAUSE · NOTICE · REFLECT" title="Mindset" intro="Understand the reaction. Make space for a pause. Return to the process you chose."><BrainExplorer/><MindsetSituations/><div id="breathing"><BreathingExercise/></div>{error&&<Notice error>{error}<Button onClick={reload}>Retry sign-in check</Button></Notice>}{!identity&&!error&&<p role="status">Checking your private workspace…</p>}{identity?.authenticated?<VisionBoard imagesEnabled={identity.images_enabled}/>:identity&&<SignInPanel identity={identity} path="/mindset" reload={reload} title="Your vision board is personal"/>}<ResourceLibrary section="mindset" identity={identity}/><p className="wp-footnote">Reflection resources and the breathing exercise are optional educational tools, not medical advice or a substitute for professional support.</p></WorkspacePage>}
