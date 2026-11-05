import React, {memo, useEffect, useState} from 'react';
import {api} from './api';
import {Button, Modal} from './components';

const endpoint = '/backtesting/drawing-templates';
const styleFields = ['lineColor', 'lineWidth', 'lineStyle', 'fillColor', 'fillOpacity', 'arrowLeft', 'arrowRight', 'extendLeft', 'extendRight'];
const textFields = ['value', 'color', 'size', 'hAlign', 'vAlign', 'bold', 'italic', 'place', 'side'];

function drawingAppearance(drawing) {
  const pick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
  return {style: pick(drawing.style, styleFields), text: pick(drawing.text, textFields)};
}

export default memo(function DrawingActions({chart}) {
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => chart.on('drawing:selected', ({id}) => setSelected(id)), [chart]);
  const selectedDrawing = selected && chart.drawings.all().find(drawing => drawing.id === selected);
  const textControls = ['hline', 'hray', 'trendline', 'box'].includes(editor?.type);

  async function openEditor() {
    setEditor({id: selected, type: selectedDrawing.type, ...drawingAppearance(selectedDrawing)});
    setTemplates([]);
    setName('');
    setError('');
    setBusy(true);
    try { setTemplates(await api(endpoint)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function mutate(method, id, body) {
    setBusy(true);
    setError('');
    try {
      const updated = await api(id ? endpoint + '/' + id : endpoint, {method, body});
      setTemplates(updated);
      setName('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  function editText(patch) {
    setEditor(value => ({...value, text:{...value.text, ...patch}}));
  }

  function apply() {
    const current = chart.drawings.all().find(drawing => drawing.id === editor.id);
    if (current) chart.drawings.update(editor.id, {style:{...current.style, ...editor.style}, text:editor.text});
    setEditor(null);
  }

  return <>
    {(selectedDrawing || copied) && <div className="bt-drawing-actions" role="toolbar" aria-label="Selected drawing actions"
      onPointerDown={event => event.stopPropagation()}>
      {selectedDrawing && <>
        <Button onClick={() => chart.drawings.duplicate([selected])}>Duplicate</Button>
        <Button onClick={() => {chart.drawings.copyToClipboard([selected]);setCopied(true);}}>Copy</Button>
      </>}
      <Button disabled={!copied} onClick={() => chart.drawings.paste()}>Paste</Button>
      {selectedDrawing && <Button onClick={openEditor}>Template</Button>}
    </div>}
    {editor && <Modal title="Drawing template & text" onClose={() => setEditor(null)}>
      <div className="bt-drawing-editor">
        {textControls && <>
          <label>Label<textarea maxLength={500} value={editor.text.value || ''} onChange={event => editText({value:event.target.value})}/></label>
          <label>Horizontal position<select value={editor.text.hAlign || 'center'} onChange={event => {
            const value = event.target.value;
            editText({hAlign:value, place:value === 'left' ? 'start' : value === 'right' ? 'end' : 'middle'});
          }}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
          <label>Vertical position<select value={editor.type === 'box' ? editor.text.vAlign || 'center' : editor.text.side || 'center'} onChange={event => {
            const value = event.target.value;
            editText(editor.type === 'box' ? {vAlign:value} : {side:value === 'center' ? undefined : value});
          }}>{(editor.type === 'box' ? [['top','Top'],['center','Middle'],['bottom','Bottom']] : [['above','Above'],['center','On'],['below','Below']]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Font size<select value={editor.text.size || 'normal'} onChange={event => editText({size:event.target.value})}>
            {['tiny','small','normal','large','huge','auto'].map(size => <option key={size}>{size}</option>)}
          </select></label>
          <label>Text colour<input type="color" value={/^#[\da-f]{6}$/i.test(editor.text.color || '') ? editor.text.color : '#3c5554'} onChange={event => editText({color:event.target.value})}/></label>
          <label><input type="checkbox" checked={!!editor.text.bold} onChange={event => editText({bold:event.target.checked})}/> Bold</label>
        </>}
        <label>Template name<input maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
        <div className="settings-actions"><Button disabled={busy || !name.trim()} onClick={() => mutate('POST', null, {name, type:editor.type, style:editor.style, text:editor.text})}>Save as template</Button></div>
        {busy && <p role="status">Updating templates…</p>}
        {error && <p role="alert">{error}</p>}
        {!busy && !templates.some(template => template.type === editor.type) && <p>No saved templates for this drawing tool.</p>}
        {templates.filter(template => template.type === editor.type).map(template => <div className="settings-actions" key={template.id}>
          <Button onClick={() => setEditor(value => ({...value, style:template.style, text:template.text}))}>Use {template.name}</Button>
          <Button disabled={busy || !name.trim()} onClick={() => mutate('PATCH', template.id, {name})} aria-label={'Rename ' + template.name}>Rename</Button>
          <Button disabled={busy} onClick={() => mutate('DELETE', template.id)} aria-label={'Delete ' + template.name}>Delete</Button>
        </div>)}
        <div className="settings-actions"><Button variant="primary" onClick={apply}>Apply to drawing</Button><Button onClick={() => setEditor(null)}>Cancel</Button></div>
      </div>
    </Modal>}
  </>;
});
