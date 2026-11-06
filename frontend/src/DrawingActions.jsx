import React, {memo, useEffect, useId, useState} from 'react';
import {api} from './api';
import {Button, Field, Modal, Select} from './components';
import {toolNames} from './DrawingFavoritesBar';

const endpoint = '/backtesting/drawing-templates';
const tabs = ['Style', 'Text', 'Coordinates', 'Visibility'];
const bands = [['s','Seconds'], ['1','1–4m'], ['5','5–14m'], ['15','15–59m'], ['60','1–3h'],
  ['240','4h+'], ['D','Daily'], ['W','Weekly'], ['M','Monthly']];
const fontSizes = [['tiny','10'],['small','12'],['normal','14'],['large','18'],['huge','24'],['auto','Auto']];
const choices = values => values.map(([value,label])=>({value,label}));
const colorValue = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value : fallback;

function utcInput(time) {
  return new Date(time).toISOString().replace('Z','');
}

export default memo(function DrawingActions({chart, id, onClose, initialTab='Style', initialTemplate=''}) {
  const [editor, setEditor] = useState(() => {
    const drawing = chart.drawings.all().find(item=>item.id===id);
    if (!drawing) return null;
    return {...drawing, style:{...drawing.style}, text:{...drawing.text},
      points:drawing.anchors.map(({time,price})=>({time:utcInput(time),price:String(price)}))};
  });
  const [tab, setTab] = useState(initialTab);
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(initialTemplate);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tabId = useId();

  useEffect(()=>{
    const controller = new AbortController();
    api(endpoint,{signal:controller.signal}).then(setTemplates).catch(failure=>{
      if(!controller.signal.aborted)setError(failure.message);
    });
    return ()=>controller.abort();
  },[]);

  if (!editor) return null;
  const edit = patch=>setEditor(current=>({...current,...patch}));
  const style = patch=>setEditor(current=>({...current,style:{...current.style,...patch}}));
  const text = patch=>setEditor(current=>({...current,text:{...current.text,...patch}}));
  const appearance = {style:editor.style,text:editor.text};

  function chooseTemplate(value) {
    setTemplate(value);
    setError('');
    if(value==='default'){
      const defaults=chart.drawings.toolDefaults()[editor.type];
      if(defaults) edit({style:{...editor.style,...defaults.style},text:{...defaults.text}});
      else setError('Save a default style for this tool first.');
    } else {
      const saved=templates.find(item=>item.id===value);
      if(saved)edit({style:{...editor.style,...saved.style},text:{...saved.text}});
    }
  }

  async function changeTemplate(method){
    setBusy(true);
    setError('');
    try {
      const path=method==='POST'?endpoint:endpoint+'/'+template;
      const body=method==='POST'?{name:name.trim(),type:editor.type,...appearance}:
        method==='PATCH'?{name:name.trim()}:undefined;
      setTemplates(await api(path,{method,body}));
      setTemplate('');
      setName('');
    } catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  function apply(event){
    event.preventDefault();
    const anchors=editor.points.map(({time,price})=>({time:Date.parse(time+'Z'),price:price.trim() ? Number(price) : NaN}));
    if(anchors.some(point=>!Number.isFinite(point.time)||!Number.isFinite(point.price))){
      setError('Enter a valid UTC time and price for each point.');
      setTab('Coordinates');
      return;
    }
    chart.drawings.update(id,{...appearance,anchors,showOn:editor.showOn,visible:editor.visible,locked:editor.locked});
    onClose();
  }

  return <Modal title={toolNames[editor.type] || 'Drawing'} className="bt-drawing-modal" onClose={onClose}>
    <form onSubmit={apply}>
      <div className="bt-drawing-tabs" role="tablist" aria-label="Drawing settings">
        {tabs.map((label,index)=><button key={label} type="button" role="tab" id={tabId+index}
          aria-selected={tab===label} aria-controls={tabId+'panel'} tabIndex={tab===label?0:-1}
          onClick={()=>setTab(label)} onKeyDown={event=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
              (index+tabs.length+(event.key==='ArrowRight'?1:-1))%tabs.length;
            setTab(tabs[next]);document.getElementById(tabId+next)?.focus();
          }}>{label}</button>)}
      </div>
      <div className="bt-drawing-editor" id={tabId+'panel'} role="tabpanel" aria-labelledby={tabId+tabs.indexOf(tab)}>
        {tab==='Style'&&<>
          <div className="bt-drawing-fields">
            <Field label="Line color"><input type="color" value={colorValue(editor.style.lineColor,'#3c5554')} onChange={e=>style({lineColor:e.target.value})}/></Field>
            <Field label="Line width"><input type="number" min="1" max="10" value={editor.style.lineWidth??1} onChange={e=>style({lineWidth:e.target.valueAsNumber || 1})}/></Field>
            <Select label="Line style" values={choices([['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']])} value={editor.style.lineStyle||'solid'} onChange={e=>style({lineStyle:e.target.value})}/>
          </div>
          {editor.type==='box'&&<div className="bt-drawing-fields">
            <Field label="Fill color"><input type="color" value={colorValue(editor.style.fillColor,'#3c5554')} onChange={e=>style({fillColor:e.target.value})}/></Field>
            <Field label="Fill opacity"><input type="range" min="0" max="1" step=".05" value={editor.style.fillOpacity??.2} onChange={e=>style({fillOpacity:e.target.valueAsNumber})}/></Field>
          </div>}
          <label><input type="checkbox" checked={!!editor.locked} onChange={e=>edit({locked:e.target.checked})}/> Lock drawing</label>
        </>}
        {tab==='Text'&&<>
          <div className="bt-drawing-fields">
            <Field label="Text color"><input type="color" value={colorValue(editor.text.color,'#3c5554')} onChange={e=>text({color:e.target.value})}/></Field>
            <Select label="Font size" values={choices(fontSizes)} value={editor.text.size||'normal'} onChange={e=>text({size:e.target.value})}/>
            <div className="bt-drawing-format">
              <Button type="button" aria-label="Bold" aria-pressed={!!editor.text.bold} onClick={()=>text({bold:!editor.text.bold})}><b>B</b></Button>
              <Button type="button" aria-label="Italic" aria-pressed={!!editor.text.italic} onClick={()=>text({italic:!editor.text.italic})}><i>I</i></Button>
            </div>
          </div>
          <Field label="Drawing text"><textarea rows={5} maxLength={500} value={editor.text.value||''} placeholder="Add text" onChange={e=>text({value:e.target.value})}/></Field>
          <div className="bt-drawing-fields">
            <Select label="Vertical alignment" values={choices([['top','Top'],['center','Middle'],['bottom','Bottom']])}
              value={editor.type==='box'?editor.text.vAlign||'center':({above:'top',below:'bottom'}[editor.text.side]||'center')}
              onChange={e=>text({vAlign:e.target.value,side:{top:'above',bottom:'below'}[e.target.value]})}/>
            <Select label="Horizontal alignment" values={choices([['left','Left'],['center','Center'],['right','Right']])} value={editor.text.hAlign||({start:'left',end:'right'}[editor.text.place]||'center')}
              onChange={e=>text({hAlign:e.target.value,place:{left:'start',right:'end'}[e.target.value]||'middle'})}/>
          </div>
        </>}
        {tab==='Coordinates'&&editor.points.map((point,index)=><div className="bt-drawing-fields" key={index}>
          {['time','price'].map(field=><Field key={field} label={`Point ${index+1} ${field==='time'?'time (UTC)':'price'}`}>
            <input type={field==='time'?'datetime-local':'number'} step={field==='time'?'.001':'any'} value={point[field]} onChange={e=>edit({points:editor.points.map((item,i)=>i===index?{...item,[field]:e.target.value}:item)})}/>
          </Field>)}
        </div>)}
        {tab==='Visibility'&&<>
          <label><input type="checkbox" checked={editor.visible!==false} onChange={e=>edit({visible:e.target.checked})}/> Visible drawing</label>
          <label><input type="checkbox" checked={!editor.showOn} onChange={e=>edit({showOn:e.target.checked?undefined:bands.map(([value])=>value)})}/> All timeframes</label>
          {editor.showOn&&<div className="bt-drawing-bands">{bands.map(([value,label])=><label key={value}>
            <input type="checkbox" checked={editor.showOn.includes(value)} onChange={e=>edit({showOn:e.target.checked?[...editor.showOn,value]:editor.showOn.filter(item=>item!==value)})}/>{label}
          </label>)}</div>}
        </>}
      </div>
      {(template==='save'||templates.some(item=>item.id===template))&&<div className="bt-drawing-fields bt-template-name"><Field label="Template name"><input maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></Field>
        <Button type="button" busy={busy} disabled={!name.trim()} onClick={()=>changeTemplate(template==='save'?'POST':'PATCH')}>{template==='save'?'Save template':'Rename template'}</Button>
        {template!=='save'&&<Button type="button" disabled={busy} onClick={()=>changeTemplate('DELETE')}>Delete template</Button>}</div>}
      {error&&<p role="alert">{error}</p>}
      <footer className="bt-drawing-footer">
        <Select label="Template" value={template} values={[
          {value:'',label:'Template'}, {value:'save',label:'Save as…'}, {value:'set-default',label:'Save as tool default'},
          {value:'default',label:'Apply tool default'}, ...templates.filter(item=>item.type===editor.type).map(item=>({value:item.id,label:item.name})),
        ]} onChange={e=>{
          if(e.target.value==='set-default'){
            chart.drawings.setToolDefaults({...chart.drawings.toolDefaults(),[editor.type]:appearance});
            setTemplate('');
            setError('');
          }else chooseTemplate(e.target.value);
        }}/>
        <div className="settings-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">OK</Button></div>
      </footer>
    </form>
  </Modal>;
});
